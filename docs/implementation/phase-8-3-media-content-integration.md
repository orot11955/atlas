# Phase 8-3 — Media Content Integration

## 목표

Content가 내부 Object Key나 MinIO Endpoint를 직접 저장하지 않고 `asset://{assetId}` 참조를 통해 READY Asset을 사용한다.

## 첫 구현 단위

READY Revision 생성 시 다음 Markdown 이미지 문법을 해석한다.

```markdown
![대체 텍스트](asset://018f3f31-7a83-7d4b-8c64-8b01f760dc3f '선택적 캡션')
```

처리 흐름:

```text
Content Draft
→ READY Revision 요청
→ asset:// Reference Parse
→ Workspace 범위 Asset 조회
→ IMAGE + READY 상태 검증
→ Content Revision 저장
→ 불변 AssetUsage 저장
```

Checkpoint Revision은 미완성 편집 상태를 보존할 수 있도록 Asset 상태를 검증하지 않는다. READY Revision만 Publication 후보가 되므로 READY 경계에서 참조를 확정한다.

## AssetUsage 불변 조건

```text
AssetUsage
├─ Workspace
├─ Asset
├─ Content Revision
├─ Ordinal
├─ Usage Kind = inline
├─ Alt Text
└─ Caption
```

- `asset_usages`는 READY Revision과 같은 Transaction에서 저장한다.
- 참조 Asset은 같은 Workspace에 존재해야 한다.
- 참조 Asset은 `image` Kind와 `ready` Status여야 한다.
- 동일 Revision의 Ordinal은 중복될 수 없다.
- AssetUsage는 생성 후 UPDATE·DELETE할 수 없다.
- Asset 원본 Bucket, Object Key와 MinIO Endpoint는 저장하지 않는다.
- Code Fence와 Inline Code 내부의 `asset://` 문자열은 참조로 해석하지 않는다.
- Raw 또는 잘못된 `asset://` 문법은 READY Revision 생성을 거부한다.

## 후속 구현 단위

```text
Asset Picker
→ Draft에 asset:// 문법 삽입
→ Cover Image, Alt Text, Caption 편집
→ READY Revision AssetUsage 조회 API
→ Publication Asset Manifest 생성
→ Public Variant URL로 immutable Snapshot 확정
→ Delivery API Manifest 제공
→ ACTIVE Publication 사용 Asset Archive 차단
```

## Publication Asset Manifest

READY Revision을 발행할 때 `AssetUsage`와 `AssetVariant`를 다시 조회해 다음 Snapshot을 Publication에 고정한다.

```text
ContentPublication.assets[]
├─ Asset ID
├─ Ordinal
├─ Usage Kind
├─ Alt Text
├─ Caption
└─ Public Variant[]
   ├─ Variant Key
   ├─ Format / Content Type
   ├─ Width / Height / Byte Size
   ├─ SHA-256 / ETag
   └─ Public URL
```

발행 시점 처리 흐름:

```text
READY Revision
→ AssetUsage 조회
→ Variant 4종 완전성 검증
→ Public URL 생성
→ Publication Asset Manifest 생성
→ bodyMarkdown의 asset:// Reference를 <picture> HTML로 변환
→ bodyHtml + Manifest + ETag 원자적 저장
```

- Publication Manifest는 최대 1 MiB다.
- `webp-320`, `webp-768`, `webp-1280`, `avif-1920`이 모두 있어야 발행할 수 있다.
- Delivery Detail은 Manifest를 반환하며 List 응답에는 포함하지 않는다.
- `bodyHtml`에는 `asset://`, Bucket Name, Object Key와 내부 MinIO Endpoint를 포함하지 않는다.
- Rollback은 과거 Publication의 `bodyHtml`, Manifest와 ETag를 그대로 복사한다.
- `asset_manifest_json`은 Publication Snapshot의 일부이므로 UPDATE할 수 없다.
