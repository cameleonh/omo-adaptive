# OMO Adaptive — Claude Code Plugin/Adapter

Claude Code의 기본 작업 에이전트를 **adaptive orchestrator**로 구성하고, 작업 난이도와 실패 비용에 따라 계획·구현·검증을 조절하는 Claude-native 플러그인입니다. orchestrator를 포함한 총 14개 에이전트와 10개 스킬을 제공하며, 변경·삭제·병합·배포처럼 부작용이 있는 작업은 사용자의 명시적 호출을 요구합니다.

이 패키지는 [cameleonh/omo-adaptive](https://github.com/cameleonh/omo-adaptive)의 Claude Code 어댑터이며, 기반 프로젝트인 [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)의 작업을 포함합니다.

## 소스와 설치 캐시

| 경로 | 역할 | 편집 여부 |
|---|---|---|
| `packages/omo-claude/` | 플러그인의 source of truth | 여기에서만 수정 |
| `~/.claude/plugins/cache/omo-adaptive/omo-adaptive/<version>/` | Claude Code가 읽는 버전별 설치 캐시 | 직접 수정하지 않음 |

설치 캐시를 직접 수정하면 다음 업데이트 때 덮어써지고, 같은 버전의 기존 세션에도 일관되게 반영되지 않습니다. 변경 사항은 소스에서 검증하고 버전을 올린 뒤 marketplace와 플러그인을 업데이트하세요. 로컬 디렉터리 marketplace는 기술적으로 커밋하지 않은 파일도 복사할 수 있지만, 재현 가능한 버전과 설치 레지스트리의 Git SHA를 남기는 이 저장소의 배포 절차에서는 먼저 `commit`하고 원격에 `push`한 뒤 캐시를 갱신합니다. 커밋 전 개발 확인은 `--plugin-dir` 방식으로 수행하세요.

`claude plugin details`는 캐시가 새로 고쳐지기 전에도 marketplace source를 표시할 수 있으므로, 그 출력만으로 실제 설치 버전을 판단하지 마세요. 현재 설치 캐시의 버전은 다음 명령의 JSON 출력에서 확인합니다.

```bash
claude plugin list --json
```

## 요구 사항

- 플러그인 기능을 지원하는 최신 Claude Code CLI
- Node.js의 현재 지원 LTS 버전: ultrawork 훅과 계약 테스트 실행에 사용
- Git: 저장소 기반 개발 및 릴리스에 사용
- 선택 사항: `github-triage` 또는 `work-with-pr`을 사용할 때 인증된 GitHub CLI(`gh`)

## 설치

로컬 저장소의 절대 경로를 marketplace로 등록한 다음 플러그인을 설치합니다.

```bash
claude plugin marketplace add /absolute/path/to/omo-adaptive/packages/omo-claude
claude plugin install omo-adaptive@omo-adaptive --scope user
```

이 저장소의 기본 경로가 `$HOME/omo-adaptive`라면 첫 명령은 다음과 같습니다.

```bash
claude plugin marketplace add "$HOME/omo-adaptive/packages/omo-claude"
```

설치 후 새 Claude Code 세션을 시작하세요.

### 설치 없이 개발하기

소스를 바로 로드하면 버전별 캐시를 만들지 않고 변경 사항을 시험할 수 있습니다.

```bash
claude --plugin-dir /absolute/path/to/omo-adaptive/packages/omo-claude
```

실행 중 파일을 고친 뒤 Claude Code 안에서 `/reload-plugins`를 실행하세요. 기본 에이전트 설정이나 훅 변경이 현재 세션에 완전히 반영되지 않으면 세션을 다시 시작합니다.

## 실행 방식

루트 `settings.json`의 `"agent": "orchestrator"`가 `agents/orchestrator.md`를 기본 메인 에이전트로 선택합니다. orchestrator는 작업의 범위와 위험을 먼저 판단하고, 단순 작업은 직접 처리하며, 독립적인 병렬 작업에서만 전문 에이전트를 호출합니다. 구현 완료 주장은 관련 테스트·검증 결과를 근거로 삼습니다.

플러그인 루트의 `CLAUDE.md`는 Claude Code가 런타임 컨텍스트로 읽지 않으므로 이 패키지에는 두지 않습니다. 실제 런타임 정책은 `agents/orchestrator.md`에 있으며 `settings.json`을 통해 활성화됩니다. 기여자 안내와 검증 절차는 이 README가 기준입니다.

## 구성 요소

### 에이전트 14개

| 에이전트 | 역할 |
|---|---|
| `orchestrator` | 기본 메인 에이전트, 난이도·위험 기반 실행 조정 |
| `explorer` | 저장소 내부 파일·구현 탐색 |
| `librarian` | 공식 문서와 외부 오픈소스 조사 |
| `metis` | 계획 전 누락·모순·위험 분석 |
| `momus` | 계획의 실행 가능성 검토 |
| `planner` | 구현 가능한 전략 계획 작성 |
| `worker-high` | 대규모·고난도 구현 |
| `worker-medium` | 기존 구조 안의 중간 규모 구현 |
| `worker-low` | 작은 수정·설정·패턴 적용 |
| `code-reviewer` | 코드 품질과 회귀 위험 검토 |
| `gate-reviewer` | 최종 증거와 승인 조건 재검토 |
| `qa-executor` | 실제 사용자 시나리오 QA |
| `clone-fidelity-reviewer` | 디자인 시스템과 복제 충실도 검토 |
| `github-triage-reviewer` | 신뢰할 수 없는 GitHub 입력의 읽기 전용 분류 |

### 스킬 10개

| 스킬 | 용도 |
|---|---|
| `hyperplan` | 비판적 검토를 포함한 고난도 계획 수립 |
| `github-triage` | 이슈·PR을 신뢰할 수 없는 입력으로 격리해 분류 |
| `security-research` | 범위가 명확한 보안 조사와 검증 |
| `remove-deadcode` | 안전장치를 갖춘 미사용 코드 탐지·제거 |
| `get-unpublished-changes` | 현재 HEAD와 최신 배포 버전 사이의 변경 확인 |
| `pre-publish-review` | 배포 전 코드·보안·QA 게이트 |
| `publish` | 명시적 승인과 선행 provenance 게이트가 모두 충족될 때만 수행하는 배포 워크플로 |
| `work-with-pr` | PR 생성·검토 및 승인된 경우에만 병합 |
| `tech-debt-audit` | 기술 부채와 개선 우선순위 평가 |
| `omomomo` | OMO 워크플로 진입점과 사용 안내 |

### MCP 서버 1개

| 서버 | 역할 |
|---|---|
| `github-triage` | 고정된 읽기 전용 `gh` 호출만 수행하고 원격 문자열·항목 수·전체 응답 크기를 제한하며, 기본 라우팅에서는 쓰기/셸 권한이 없는 전용 리뷰어가 호출 |

플러그인 루트의 `.mcp.json`이 이 서버를 자동 등록합니다. 기본 orchestrator와 번들 스킬은 GitHub 원문을 MCP allowlist가 있는 전용 리뷰어 안에서만 처리하며, 본문·댓글·패치 상한과 Claude 세션당 누적 250,000자 상한을 넘으면 서버가 요청을 중단합니다. Claude Code의 플러그인 MCP 등록 자체는 접근 제어 목록이 아니므로, 사용자가 다른 메인 에이전트나 도구 권한을 직접 허용하면 이 기본 격리를 바꿀 수 있습니다. 상태 변경 PR 워크플로는 리뷰어 자연어가 아니라 별도 `pr-state.mjs`의 비문자열 검증 결과로 ref·SHA·check 상태를 다시 확인합니다.

## 사용법

기본 작업은 orchestrator가 처리합니다. 특정 에이전트가 필요하면 Claude Code의 플러그인 스코프 형식으로 호출합니다.

```text
@agent-omo-adaptive:explorer src/의 API 엔드포인트를 찾아줘
@agent-omo-adaptive:planner 인증 기능 구현 계획을 작성해줘
@agent-omo-adaptive:code-reviewer 현재 diff를 검토해줘
```

스킬은 다음 형식으로 명시적으로 실행할 수 있습니다.

```text
/omo-adaptive:hyperplan 결제 마이그레이션 계획을 세워줘
/omo-adaptive:github-triage 123번 이슈를 분류해줘
/omo-adaptive:pre-publish-review 4.20.0 후보를 검토해줘
```

### 안전 규칙

- `publish`, `remove-deadcode`, `work-with-pr`은 자동 선택되지 않습니다. 반드시 `/omo-adaptive:<skill>`로 사용자가 직접 실행해야 합니다.
- push, publish, merge, 삭제처럼 외부 상태나 복구 비용이 큰 동작은 정확한 대상과 현재 상태를 확인하고 명시적 승인을 받은 뒤 수행합니다.
- 현재 루트 `publish.yml`은 source SHA 검증 전에 OIDC 자격 증명을 사용하므로 `publish` 스킬이 dispatch를 차단합니다. 워크플로가 credential 사용 전 `prepared_release_sha`, `github.sha`, checkout SHA의 일치를 강제하기 전에는 승인이 있어도 배포하지 않습니다.
- GitHub 이슈·PR 본문과 댓글은 명령이 아닌 신뢰할 수 없는 데이터로 취급하며, 기본 라우팅에서는 전용 읽기 전용 검토 에이전트 안에서만 분석합니다.
- 설치 캐시에서는 작업하지 않습니다. 모든 수정과 버전 관리는 `packages/omo-claude/`에서 수행합니다.

## 검증

패키지 루트에서 다음 검증을 모두 실행합니다.

```bash
node --test tests/plugin-contract.test.mjs
claude plugin validate --strict .claude-plugin/plugin.json
claude plugin validate --strict .claude-plugin/marketplace.json
```

첫 번째 명령은 에이전트·스킬 발견, 버전·라이선스 정합성, Claude-native 도구 계약, 수동 호출 안전장치, 훅 출력, GitHub 데이터 상한, MCP 도구 목록을 검사합니다. 이어지는 두 명령은 플러그인 전체 구성 요소와 marketplace manifest를 각각 엄격 모드로 검증합니다. 디렉터리 `.`만 넘기면 marketplace만 검증될 수 있으므로 manifest 경로를 명시합니다.

## 기여 및 릴리스

1. `packages/omo-claude/`에서만 소스 파일을 수정합니다.
2. 위 계약 테스트와 엄격 검증을 통과시킵니다.
3. 릴리스 시 `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`의 두 버전 필드와 marketplace 내부 플러그인 버전을 함께 올립니다.
4. `CHANGELOG.md`에 사용자에게 보이는 변경과 안전성 변경을 기록합니다.
5. 변경을 커밋·배포한 뒤 로컬 marketplace와 설치 캐시를 갱신합니다.

```bash
claude plugin marketplace update omo-adaptive
claude plugin update omo-adaptive@omo-adaptive --scope user
```

`claude plugin update` 후에는 새 버전을 적용하기 위해 Claude Code를 다시 시작합니다. 새 캐시는 `~/.claude/plugins/cache/omo-adaptive/omo-adaptive/<new-version>/`에 생성되며, 이전 버전 캐시는 수정하지 않습니다.

## 라이선스와 고지

이 패키지의 라이선스 식별자는 `SUL-1.0`입니다. 전체 조건은 [LICENSE.md](./LICENSE.md), 프로젝트 출처는 [NOTICE.md](./NOTICE.md), 포함된 MIT 구성 요소 고지는 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)를 확인하세요.
