import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { parse } from 'csv-parse/sync';
import axios from 'axios';
import { getPrismaClient } from '@/lib/prisma';

// Clerk API Key
const clerkApiKey = 'sk_test_eE2ZdMoVVr5taX4XRBm7NWuBRIP0BLgCcTXRWWGQg6'; // Replace with your actual Clerk API key

// Helper function to clean and validate dates
function cleanDate(dateString: string): string {
  const cleaned = dateString.replace(/[^\x00-\x7F]/g, '').replace(/[^\d\-\/]/g, '');
  return cleaned;
}

function isValidDate(dateString: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  return regex.test(dateString);
}

// Helper function to fetch all classes once and cache them
async function getClassMap(prisma: any) {
  const classes = await prisma.class.findMany({
    select: { id: true, name: true },
  });
  return new Map(classes.map((c: { id: string; name: string }) => [c.name.toLowerCase(), c.id]));
}

export async function POST(request: Request) {
  try {
    const prisma = getPrismaClient();
    const { fileContent, academicYear } = await request.json();
    console.log('Academic Year:', academicYear);

    if (!fileContent || !academicYear) {
      return NextResponse.json(
        { error: 'CSV file content and academic year are required.' },
        { status: 400 }
      );
    }

    let records: any[];

    // Parse file content (JSON or CSV)
    if (fileContent.trim().startsWith('[{')) {
      records = JSON.parse(fileContent);
    } else {
      const buffer = Buffer.isBuffer(fileContent)
        ? fileContent
        : Buffer.from(fileContent, 'utf-8');
      records = parse(buffer.toString(), {
        columns: true,
        skip_empty_lines: true,
      });
    }
    console.log('Parsed records:', records);

    const students = [];
    const errors = [];

    // Cache all classes once
    const classMap = await getClassMap(prisma);

    // Process each row
    for (const [index, row] of records.entries()) {
      let cleanedDob: string | null = null;
      if (row.dob) {
        const cleaned = cleanDate(row.dob);
        if (isValidDate(cleaned)) {
          cleanedDob = cleaned;
        } else {
          errors.push(`Invalid date format for dob in row ${index + 1}: ${JSON.stringify(row)}`);
          continue;
        }
      }

      if (!row.name || !row.className || !academicYear) {
        errors.push(`Missing required fields (name, className, academicYear) in row ${index + 1}: ${JSON.stringify(row)}`);
        continue;
      }

      const normalizedClassName = row.className.trim().toLowerCase();
      const classId = classMap.get(normalizedClassName);
      if (!classId) {
        errors.push(`Class not found for className: ${row.className} (normalized: ${normalizedClassName}) in row ${index + 1}`);
        continue;
      }

      students.push({
        ...row,
        dob: cleanedDob ? new Date(cleanedDob) : null,
        classId,
      });
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('\n') }, { status: 400 });
    }

    const createdStudents = [];
    const trimesters = ['First Trimester', 'Second Trimester', 'Third Trimester'];

    for (const [index, student] of students.entries()) {
      const {
        name,
        arabicName,
        school,
        className,
        nationality,
        iqamaNo,
        passportNo,
        expenses = 'paid',
        username: rawUsername,
        password: rawPassword,
        dob,
        classId,
      } = student;

      console.log(`Processing student ${index + 1}: ${name}, classId: ${classId}, className: ${className}`);

      // Validate and trim username and password
      const username = (rawUsername || '').trim();
      const password = (rawPassword || '').trim();

      if (!username || !password) {
        errors.push(`Username or password missing for ${name} (row ${index + 1})`);
        continue;
      }
      if (password.length < 8) {
        errors.push(`Password for ${name} (row ${index + 1}) must be at least 8 characters`);
        continue;
      }

      let newStudent: any = null;

      // Step 1: Create the student in the database
      try {
        newStudent = await prisma.student.create({
          data: {
            name,
            arabicName,
            school,
            nationality,
            iqamaNo,
            passportNo,
            expenses,
            username,
            password, // Store raw password for reference (consider hashing if needed)
            dateOfBirth: dob,
            classId,
          },
        });
        console.log('Student created in the database:', newStudent);
      } catch (error) {
        console.error(`Error creating student ${name} (row ${index + 1}):`, error);
        errors.push(`Failed to create student ${name} (row ${index + 1}): ${error.message}`);
        continue;
      }

      // Step 2: Create the user in Clerk
      try {
        const clerkPayload = {
          email_addresses: [{ email_address: `${username}@yourdomain.com` }],
          first_name: name,
          username,
          password,
          public_metadata: { role: 'STUDENT', school },
          external_id: newStudent.id,
        };
        console.log(`Sending to Clerk for ${name}:`, JSON.stringify(clerkPayload));

        const clerkResponse = await axios.post(
          'https://api.clerk.dev/v1/users',
          clerkPayload,
          {
            headers: {
              Authorization: `Bearer ${clerkApiKey}`,
              'Content-Type': 'application/json',
            },
          }
        );

        console.log(`Clerk user created for ${name}:`, clerkResponse.data);
        if (!clerkResponse.data.id) {
          throw new Error('Clerk user creation succeeded but no user ID returned');
        }
      } catch (clerkError) {
        console.error(`Failed to create Clerk user for ${name} (row ${index + 1}):`, clerkError);
        if (axios.isAxiosError(clerkError)) {
          console.error('Clerk error details:', clerkError.response?.data || clerkError.message);
          errors.push(`Failed to create Clerk user for ${name} (row ${index + 1}): ${clerkError.response?.data?.message || clerkError.message}`);
        } else {
          errors.push(`Failed to create Clerk user for ${name} (row ${index + 1}): ${clerkError.message || 'Unknown error'}`);
        }

        // Clean up database entry if Clerk fails
        if (newStudent) {
          await prisma.student.delete({ where: { id: newStudent.id } });
          console.log(`Cleaned up student ${name} from database due to Clerk failure`);
        }
        continue;
      }

      createdStudents.push(newStudent);

      // Step 3: Create marks for the student
      const classSubjects = await prisma.classSubject.findMany({
        where: { classId },
      });

      if (!classSubjects.length) {
        errors.push(`No subjects found for classId: ${classId} in row ${index + 1}`);
        continue;
      }

      const marksData = classSubjects.flatMap((subject) =>
        trimesters.map((trimester) => ({
          id: randomUUID(),
          studentId: newStudent.id,
          subjectId: subject.subjectId,
          academicYear,
          trimester,
          classId,
          participation: 0,
          homework: 0,
          quiz: 0,
          project: 0,
          exam: 0,
          classActivities: 0,
          memorizing: 0,
          oral: 0,
          reading: 0,
        }))
      );

      try {
        await prisma.mark.createMany({
          data: marksData,
          skipDuplicates: true,
        });
        console.log(`Marks created for ${name} in class ${className} (row ${index + 1})`);
      } catch (error) {
        console.error(`Error creating marks for ${name} (row ${index + 1}):`, error);
        errors.push(`Failed to create marks for ${name} (row ${index + 1}): ${error.message}`);
        continue;
      }
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { error: errors.join('\n'), createdStudents },
        { status: 207 } // Multi-status for partial success
      );
    }

    return NextResponse.json(
      { message: 'All students and Clerk users created successfully', students: createdStudents },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error during bulk upload:', error);
    return NextResponse.json({ error: 'Error during bulk upload: ' + error.message }, { status: 500 });
  }
}