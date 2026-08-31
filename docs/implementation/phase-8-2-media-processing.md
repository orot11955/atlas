# Phase 8-2 — Media Processing & Variants

## 처리 흐름

```text
Private Asset Upload 완료
→ API가 BullMQ `media.process` Job enqueue
→ Worker가 Asset Processing Attempt claim
→ Private 원본 Size·SHA-256 재검증
→ Sharp Decode
→ Dimension·Pixel·Animation 제한
→ EXIF·GPS Metadata 제거
→ WebP 320 / 768 / 1280 생성
→ AVIF 1920 생성
→ atlas-processing 임시 저장
→ atlas-public 불변 Variant Key로 확정
→ AssetVariant 저장
→ Asset READY
```

## Queue 계약

```text
Queue   atlas-media
Job     media.process
Job ID  {assetId}-{assetVersion}
Retry   3회, exponential backoff
```

Job Payload에는 다음 값만 포함한다.

```text
workspaceId
assetId
assetVersion
correlationId
```

Bucket Name, Object Key, 내부 MinIO Endpoint는 Job 결과, Log, Audit와 외부 DTO에 포함하지 않는다.

## 처리 상태

```text
UPLOADED
→ PROCESSING
→ READY

PROCESSING 실패
├─ 재시도 가능: UPLOADED
└─ 최종 실패: FAILED
```

동일 Asset의 활성 `AssetProcessingAttempt`는 하나만 허용한다. 동일 BullMQ Job의 재시도 또는 stale Attempt는 회수하고, 다른 활성 Job이 처리 중이면 중복 처리를 시작하지 않는다.

## Decode 제한

기본값:

```text
Input Size       25 MiB
Output Size      Variant당 25 MiB
Pixel Count      40,000,000
Maximum Dimension 12,000 px
Animated Image   차단
Multi-page Image 차단
```

지원 원본:

```text
image/jpeg
image/png
image/webp
```

Public Variant:

```text
webp-320
webp-768
webp-1280
avif-1920
```

Sharp 출력에는 `withMetadata()`를 사용하지 않으며, 원본의 EXIF, GPS와 XMP Metadata를 공개 Variant에 복사하지 않는다.

## Object Storage 경계

```text
atlas-private
└─ 검증된 불변 원본

atlas-processing
└─ Attempt별 임시 Variant

atlas-public
└─ 외부 제공용 불변 Variant
```

DB 완료 전에 생성된 Processing·Public Object는 실패 시 제거한다. DB 완료 후 Processing Object 정리는 best-effort로 수행하고, 잔존 Object는 후속 maintenance Job이 처리한다.

## Audit

성공:

```text
asset.processing-completed
```

실패:

```text
asset.processing-failed
```

Audit에는 `assetId`, `attemptId`, `attemptNumber`, 안전한 failure code와 Variant Key만 기록한다. Object Key와 URL은 기록하지 않는다.

## 완료된 CI 검증

```text
Upload Session
→ Presigned PUT
→ Upload Complete
→ media.process enqueue
→ Worker 처리
→ Asset READY 확인
→ AssetVariant 4개 확인
→ atlas-public Object 확인
→ EXIF·GPS 미포함 확인
```

`Media Data Gate`는 PostgreSQL, Redis, 실제 MinIO, API와 Worker를 함께 실행해 정상 이미지의 READY 전이와 손상 이미지의 최종 FAILED 전이를 검증한다.

## 후속 범위

다음 Content 연동은 별도 `feat/media-content-integration` Branch에서 구현한다.

```text
AssetUsage
asset://{assetId} Parser
Asset Picker
Cover Image
Alt Text
Caption
Publication Asset Manifest
ACTIVE Publication 사용 Asset Archive 차단
Delivery Snapshot의 Public Variant 고정
```
