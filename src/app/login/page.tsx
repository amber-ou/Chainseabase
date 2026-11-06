import { Suspense } from 'react';
import { LoginScreen } from '@/features/login';

export default function LoginPage() {
  return <Suspense><LoginScreen /></Suspense>;
}
