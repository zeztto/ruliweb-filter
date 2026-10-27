# 변경 기록

## 0.1.1 — 2026-10-28

- standalone source edition으로 설치·권한·개인정보·검증 범위를 문서화했습니다.
- first-party source에 MIT License를 적용하고 dependency lock과 최소 권한 CI를 추가했습니다.
- storage callback 오류를 성공으로 표시하던 문제를 수정하고 저장 성공 후에만 목록의 필터 state를 바꿉니다.
- 잘못된 필터 map을 거부해 가져오기 중 기존 필터가 지워지는 문제를 막았습니다.
- 옵션 저장·초기화 실패와 읽기 실패 차단을 포함한 regression 검사를 추가했습니다.
- storage 문서 schema는 version 1을 유지합니다.

## 0.1.0

- 게시판·게시판 탭·제목 말머리 필터, 게시판명 cache, JSON 필터 가져오기·내보내기를 구현했습니다.
