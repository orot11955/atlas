# Atlas

Atlas는 개인 자료, 프로젝트 이력, 배포 상태, 블로그 콘텐츠와 회원을 한곳에서 관리하는 개인 관리 플랫폼입니다.

관리자 패널을 우선 구축하고, 향후 추가되는 블로그 애플리케이션은 Atlas의 Delivery API와 Webhook을 통해 게시된 콘텐츠를 제공받습니다.

## 문서

- [플랫폼 설계](docs/atlas-platform-design.md)

## 기본 기술 방향

- Admin Web: Next.js + TypeScript
- Backend: NestJS + TypeScript
- Database: PostgreSQL + TypeORM
- Queue/Worker: Redis + BullMQ
- Object Storage: Amazon S3 또는 S3-compatible storage
- API Contract: OpenAPI
- Deployment: Docker Compose + Nginx

## 핵심 원칙

- 관리자 API, 콘텐츠 Delivery API, 시스템 Integration API를 분리합니다.
- 여러 블로그를 `Site` 단위로 관리합니다.
- 편집 중인 콘텐츠와 외부에 제공되는 불변 Publication Snapshot을 분리합니다.
- S3 원본 객체는 비공개로 저장하고 공개용 Variant만 전달합니다.
- 관리자 계정, 일반 회원, API Client의 인증 경계를 분리합니다.
