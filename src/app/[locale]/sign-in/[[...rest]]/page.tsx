'use client';

import { SignIn } from '@clerk/nextjs';
import { useParams } from 'next/navigation';

export default function SignInPage() {
  const { locale } = useParams();

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100">
      <SignIn
        routing="path"
        path={`/${locale}/sign-in`}
        signUpUrl={`/${locale}/sign-up`}
        forceRedirectUrl={`/${locale}`}
      />
    </div>
  );
}