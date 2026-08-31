# Phase 8 — MinIO Media

## Phase 8-1: Private Asset Upload Foundation

```text
Admin Upload Request
→ Asset와 UploadSession 생성
→ atlas-private용 Presigned PUT 발급
→ Browser가 MinIO에 직접 업로드
→ API가 Size, SHA-256, Metadata와 Magic Byte 검증
→ 임시 Object를 불변 원본 Key로 복사
→ 임시 Object 제거
→ Asset를 UPLOADED로 전환
```

이번 수직 단위는 **Private 원본 업로드와 서버 재검증 경계**까지 구현한다. Variant 생성, EXIF 제거, WebP·AVIF 변환, `asset://` 해석과 Publication Asset Manifest는 다음 전용 수직 단위에서 연결한다.

## 데이터 모델

```text
Asset
├─ Workspace Scope
├─ 원본 File Name
├─ 선언·검출 Content Type
├─ 예상·실제 Size
├─ SHA-256
├─ 상태와 Version
└─ Private 원본 Object Reference

AssetUploadSession
├─ 짧은 만료 시각
├─ 임시 Object Reference
├─ 예상 Size·SHA-256·Content Type
└─ PENDING / COMPLETED / FAILED
```

Upload Session 완료 요청은 Idempotent하다. 이미 검증이 끝난 Session을 다시 완료해도 중복 Asset이나 Object를 만들지 않고 현재 결과를 반환한다.

## 보안 경계

- 원본은 `atlas-private`에만 저장한다.
- API 응답에는 Bucket, 임시 Object Key와 원본 Object Key를 포함하지 않는다.
- Application Service 반환 계약에서도 임시 Object Key를 제거한다.
- `image/jpeg`, `image/png`, `image/webp`만 허용한다.
- SVG, HTML과 선언 MIME이 다른 파일은 거부한다.
- 업로드 완료 시 서버가 전체 Object를 Streaming하며 SHA-256과 실제 Size를 다시 계산한다.
- Magic Byte로 실제 이미지 형식을 검증한다.
- 최대 Upload Size는 Presigned URL 발급 전과 완료 검증 시점에 모두 적용한다.
- Presigned URL은 짧은 만료 시간을 사용한다.
- 완료된 원본은 임시 Upload Key와 분리된 불변 Asset Key로 복사한다.
- 검증 실패 시 임시 Object를 제거하고 Asset와 Upload Session을 FAILED로 전환한다.
- Audit Log에는 Asset·Upload Session 식별자와 실패 Code만 기록하며 Object Key와 URL은 기록하지 않는다.

## Admin API

```text
GET  /api/admin/v1/assets
GET  /api/admin/v1/assets/{assetId}
POST /api/admin/v1/assets/upload-sessions
POST /api/admin/v1/assets/upload-sessions/{uploadSessionId}/complete
```

조회는 `contents:read`, 변경은 `contents:manage` Permission을 요구한다. 변경 API는 Admin Session, Workspace Scope와 Double-submit CSRF를 모두 통과해야 한다.

## Admin Web

```text
/admin/assets
```

Browser에서 SHA-256을 계산한 뒤 Presigned PUT으로 직접 업로드하고, 완료 요청을 통해 서버 검증을 시작한다. 관리자 화면에는 Storage 내부 식별자를 노출하지 않고 File Name, 상태, Size, Content Type, SHA-256 Prefix와 시각만 표시한다.

## 다음 수직 단위

```text
feat/media-processing-variants

BullMQ media.process
→ Sharp Decode 검증과 Decode Bomb 제한
→ EXIF·위치정보 제거
→ WebP·AVIF Variant 생성
→ atlas-public 저장
→ Asset READY
→ AssetUsage와 Publication Asset Manifest
→ Content Asset Picker와 Cover Image
```
