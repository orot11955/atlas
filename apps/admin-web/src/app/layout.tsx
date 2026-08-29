import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Atlas Control Plane',
    template: '%s · Atlas',
  },
  description: '개인 콘텐츠, 프로젝트, 배포와 회원을 관리하는 Atlas 관리자 패널',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
