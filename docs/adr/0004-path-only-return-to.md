# ADR 0004 — `return_to`에 same-origin path-only 수용

**Status**: Accepted (2026-04)

## Context

로그인·프로젝트 선택 플로우는 쿼리 파라미터 `return_to`로 "이 작업이 끝나면 돌아갈 곳"을 전달한다. 원래 `isSafeReturnUrl()` validator는 `new URL(raw)`를 시도 → 절대 URL만 수용했다.

Multi-Zones 전환(ADR 0001) 이후 미들웨어는 path-only `return_to`를 생성한다:
```
/login?return_to=%2Fiss%2Fdashboard
```

이유는 zone의 internal origin을 브라우저에 노출하지 않기 위함. validator가 path-only를 거부하면 로그인 후 원래 경로로 복귀가 실패.

한편 `return_to`는 전형적인 **open redirect** 벡터이므로 수용 범위 확장에 보안 고려가 필요하다.

## Decision

path-only 값을 수용하되 다음 규칙으로 open redirect를 차단:

```ts
if (raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) {
  return raw
}
```

- `/`로 시작해야 함 (origin-relative)
- `//evil.com` 같은 **scheme-relative URL** 거부 — 브라우저가 외부 origin으로 해석
- `/\evil.com` 같은 **backslash 트릭** 거부 — 일부 브라우저(특히 구형)가 `//evil.com`으로 정규화

절대 URL fallback은 유지(localhost dev, `NEXT_PUBLIC_ALLOWED_RETURN_HOSTS` allow-list) — 기존 호환.

적용 위치:
- `apps/shell/src/app/login/page.tsx`
- `apps/shell/src/app/project/actions.ts`

두 파일 모두 동일 로직 (중복이지만 server/client 경계라 shared 모듈로 빼기엔 작음).

## Consequences

**Good**
- Multi-Zones redirect 경로가 작동. 툴 zone으로의 복귀가 내부 origin 노출 없이 성립.
- open redirect 벡터 두 가지(`//`·`/\`) 명시적 차단.
- 테스트 용이 — path 5개(정상 3, 공격 2) unit validate 가능.

**Bad / 주의사항**
- 다른 path traversal 공격(예: 제어 문자, null byte)은 브라우저·Next.js 레벨에서 처리됨 가정. 필요 시 추가 sanitization.
- 로직이 두 파일에 복제됨 — 규칙이 바뀌면 둘 다 수정. 세 번째 복제가 필요해지면 `packages/auth`로 빼는 것을 고려.

**Revisit 조건**: 새로운 return_to 소비처가 생기거나, 더 엄격한 path allow-list(예: `/iss`, `/index`, `/drawings` 셋으로만 제한)가 요구되면 재검토.
