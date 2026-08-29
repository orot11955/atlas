# Atlas

Atlas는 개인 자료, 프로젝트 이력, 배포 상태, 여러 Site의 콘텐츠와 회원을 한곳에서 관리하는 개인 관리 플랫폼입니다.

관리자 패널을 우선 구축합니다. 이후 추가되는 블로그, 포트폴리오와 문서 사이트는 Atlas의 Delivery API와 Webhook을 통해 게시된 콘텐츠를 제공받습니다.

## 문서

- [플랫폼 설계](docs/atlas-platform-design.md)
- [브랜치 전략](docs/branch-strategy.md)

## 기본 기술 방향

- Admin Web: Next.js + TypeScript
- Backend: NestJS + TypeScript
- Database: PostgreSQL + TypeORM
- Queue/Worker: Redis + BullMQ
- Object Storage: MinIO
- API Contract: OpenAPI
- Deployment: Docker Compose + Nginx

## 핵심 원칙

- 관리자 API, 콘텐츠 Delivery API, 시스템 Integration API를 분리합니다.
- 여러 블로그와 외부 애플리케이션을 `Site` 단위로 관리합니다.
- 하나의 원본 콘텐츠를 여러 Site에 서로 다른 slug와 SEO로 게시할 수 있습니다.
- 편집 중인 콘텐츠와 외부에 제공되는 불변 Publication Snapshot을 분리합니다.
- MinIO의 원본 객체는 비공개로 저장하고 공개용 Variant만 전달합니다.
- 관리자 계정, 일반 회원과 API Client의 인증 경계를 분리합니다.

## 브랜치

```text
feature/*
  ↓ Pull Request
develop
  ↓ Release Pull Request
main
  ↓ Tag / Production Deployment
```

- `develop`: 기본 개발 및 통합 브랜치
- `main`: 운영 배포 기준 브랜치
- 운영 배포 전까지 일반 기능과 문서 변경은 `develop`에 반영합니다.

## 현재 단계

```text
Repository Foundation
→ Admin Foundation
→ Site와 API Client
→ 콘텐츠 작성·게시·Delivery API
→ MinIO Media
→ Webhook과 예약 게시
→ 프로젝트와 배포
→ 자료실과 회원
```
