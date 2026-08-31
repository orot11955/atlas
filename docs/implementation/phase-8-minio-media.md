# Phase 8 — MinIO Media

## 첫 수직 단위

```text
Admin Upload Request
→ Asset와 UploadSession 생성
→ atlas-private용 Presigned PUT 발급
→ Browser가 MinIO에 직접 업로드
→ API가 크기, SHA-256과 Magic Byte 검증
→ 임시 Object를 불변 원본 Key로 복사
→ Asset를 UPLOADED로 전환
```

이번 단위는 원본 업로드 경계까지만 구현한다. Variant 생성, EXIF 제거, WebP·AVIF 변환, `asset://` 해석과 Publication Asset Manifest는 후속 수직 단위에서 연결한다.

## 보안 경계

- 원본은 `atlas-private`에만 저장한다.
- API 응답에는 Bucket과 Object Key를 포함하지 않는다.
- `image/jpeg`, `image/png`, `image/webp`만 허용한다.
- SVG, HTML과 선언 MIME이 다른 파일은 거부한다.
- 업로드 완료 시 서버가 전체 Object의 SHA-256을 다시 계산한다.
- Presigned URL은 짧은 만료 시간을 사용한다.
- 완료된 원본은 임시 Upload Key와 분리된 Asset Key로 복사한다.
