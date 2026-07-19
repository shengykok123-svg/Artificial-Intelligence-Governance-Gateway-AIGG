# M9 数据标注规则与训练流程（中文版）

> English reference: [M9_ANNOTATION_GUIDE.md](M9_ANNOTATION_GUIDE.md)

## 目的

M9 的用途是识别英文文字中**未公开或内部的、与特定部门有关的敏感内容**。M9 不负责决定最终政策结果；当 M9 报告一个 `DEPT_CONFIDENTIAL` span 后，现有的 M3 policy engine 才决定该 prompt 应该 allow、redact、hold 或 deny。

本文件定义 two-head target schema，并定义建立小型高质量（gold）dataset 的人工审核流程。Gold dataset 的意思是：每个例子都由人根据本规则审核和标注，而不是从网上抓文字后自动猜标签。

## Two-head target schema

M9 使用一个共享的 DeBERTa encoder 和两个独立 output heads，不是让第一个 classifier 的结果控制第二个 classifier。这样 department prediction 错了，也不会直接导致 sensitivity prediction 一起错。

```text
department:      finance | hr | legal | engineering | other
is_confidential: true | false
```

目前 repo 的 code 和 synthetic data 已支持这个 schema，但 synthetic data 仍只用于验证 pipeline wiring，不能用来声明模型准确率。

## 标注单位与资料格式

每个例子应是一句完整英文句子，或一段可独立理解的短文字（通常一至三句）。提交到 Git 前，必须移除或替换真实个人资料、账号、secret 和客户名称。

```json
{"id":"fin-001","source_group":"synthetic-finance-01","text":"The unreleased Q4 forecast projects a RM 2 million shortfall.","department":"finance","is_confidential":true,"rationale":"Unreleased internal financial forecast."}
```

- `id`：稳定且唯一的记录 ID。
- `source_group`：原始文件或生成 batch。来自同一个 source group 的所有记录只能放在一个 split。
- `text`：经过脱敏、给模型读取的英文文字。
- `department`：必须是下列其中一个 department label。
- `is_confidential`：boolean sensitivity label。
- `rationale`：人工标注理由。应保留在私人的 annotation source；trainer 不一定需要读取它。

## Department 与 sensitivity labels

| Department | 何时使用 | Confidential 例子 | Non-confidential 例子 |
| --- | --- | --- | --- |
| `finance` | 预算、预测、收入/利润数字、定价、融资、并购估值或财务决定。 | "The draft acquisition budget caps the offer at RM 4.2 million." | "The company published annual revenue in its investor report." |
| `hr` | 员工、招聘、薪资、绩效、请假、纪律或 workforce planning。 | "Aisha's performance review recommends a below-expectations rating." | "The public leave policy grants fourteen annual-leave days." |
| `legal` | 合约、谈判、法律意见、纠纷、调查或 legal strategy。 | "Counsel recommends settling before the draft claim is filed." | "The terms of service are available on the public website." |
| `engineering` | Source code、系统架构、credentials、安全、product roadmap 或技术事故。 | "The production API key is stored in the legacy payment service." | "The public API documentation describes authentication." |
| `other` | 本 MVP 中没有明确 department 的内容。 | 不可设置 `is_confidential=true`。 | "Create an agenda for an open customer webinar." |

`is_confidential=true` 指依照团队 policy 的内部/未公开内容；**不是**只要一句话提到某个部门就自动算 confidential。例如公开财报可以是 `department=finance, is_confidential=false`。

## 标注员决策规则

1. 阅读完整例子；如果有 source context，也一起阅读。
2. 选择最直接负责该内容的 department；只有完全不属于这些部门才标 `other`。
3. 独立判断它是否为非公开/内部、且 gateway 应 flag 的内容；只有是才设置 `is_confidential=true`。
4. 每个记录只用一个标签。若一句话含两个部门风险，选择该句最主要的风险；若两段内容可独立理解，应拆成两个例子。
5. 不要因为出现公司名称、finance word 或 technical term 就推定 confidential。它可以保留 department，但设 `is_confidential=false`。
6. 真的无法判断时，在私人的 annotation sheet 标为 `needs_review`；两位 reviewer 解决前，不要写进 training JSONL。

### 边界例子

| Text | Label | 原因 |
| --- | --- | --- |
| "The CFO will present the unreleased cash-flow forecast on Friday." | `finance`, `true` | 内部预测。 |
| "The CFO presented annual results in a public earnings call." | `finance`, `false` | 已公开披露。 |
| "Please update Jia Wei's salary adjustment in the payroll system." | `hr`, `true` | 可识别的薪资资料。 |
| "Our public careers page describes the interview process." | `hr`, `false` | 公开、一般的 HR 内容。 |
| "The counterparty rejected clause 7 in the unexecuted supplier agreement." | `legal`, `true` | 未签署合约的谈判内容。 |
| "This open-source repository uses an MIT licence." | `legal`, `false` | 公开技术/法律内容。 |
| "The staging database password is in the incident channel." | `engineering`, `true` | credentials/security information。 |
| "Use HTTPS to encrypt traffic." | `engineering`, `false` | 一般公开建议。 |

## 资料收集与审核流程

```text
已批准的资料来源 / 谨慎编写的 synthetic scenarios
  -> 移除真实个人资料、secret 与客户资料
  -> 标注员依本规则标注，并写 rationale
  -> 第二位标注员独立审核
  -> 解决不同意见；无法解决的例子移除
  -> 以完整 source_group 分配 train / validation / test
  -> 验证 JSONL schema
  -> fine-tune DeBERTa
  -> 用完全未参与训练的 test set 评估，并检查 error
  -> 校准 threshold，保存 model 和 metrics
  -> 通过 acceptance checks 后才在 gateway 启用 M9
```

### 第一版 dataset 建议

第一版 demo 建议每个 label 至少 100 个经过审核的例子（总计约 500 个），之后再扩展到每类 200--500 个。`other` 必须多样化：公开 finance、公开 HR policy、公开合约、公开技术文件、普通聊天和 near-miss examples 都应该包括。

公开资料只能提供 language style，不能直接当 confidential。例如公开 SEC filings、公开合约、公开 policy 和 open-source code 不应因为主题而标成 confidential；它们通常适合当作 `other` 或 controlled near-miss examples。

## Split、训练、评估与部署

1. **Freeze annotation set。** 保留一份私人的 source/rationale sheet；只能把已脱敏并获准放进 repo 的资料 commit。
2. **依 `source_group` split，不可随机按句 split。** 建议比例：70% train、15% validation、15% test。不要用 test set 调参。
3. **训练。** 在 train split 上 fine-tune `microsoft/deberta-v3-small`；使用 validation loss 及各 label 的 precision/recall/F1 选择 checkpoint。
4. **评估。** 最终选定 model 后，只在 untouched test set 上运行一次。检查 confidential text 的 false negative，也检查 public material 的 false positive；两者对 governance gateway 都重要。
5. **校准。** 以 validation data 和团队可接受的 false-positive/false-negative trade-off 选择 runtime confidence threshold。初始值 `0.65` 不是已验证的正确值。
6. **整合。** 两个 heads 都有足够信心、且 `is_confidential=true` 时，才映射为 `DEPT_CONFIDENTIAL`；department 则作为 `content_department`。`detect()` 必须返回 sentence offsets；M3 仍然是 policy decision-maker。
7. **Acceptance test。** 测试文字 prompt 和已 extract 的 attachment text。PDF 是否可用还取决于 M5 extraction；scanned PDF 需要 OCR，在 M5 加入前不在范围内。

## 团队职责

| 角色 | 责任 |
| --- | --- |
| Data owner | 批准资料来源，并确认没有真实 confidential content 被 commit。 |
| Annotators | 独立按本规则标注，并记录 rationale。 |
| M9 engineer | 验证数据、训练/评估 model，并记录 metrics 和 error examples。 |
| M1/M3 integration owner | 确保 output 符合 frozen contracts，且 policy 仍在 M9 以外。 |
| Demo owner | 清楚说明 M9 是否已训练、使用什么资料，以及实测限制。 |

## 开始训练前 checklist

- [ ] 每个记录都同时有 department 与 sensitivity labels。
- [ ] 所有文字都是 English、已脱敏，并获准用于 repo。
- [ ] 每个记录在私人的 annotation source 中都有 label、rationale 和 source group。
- [ ] 两位 reviewer 已解决不同意见。
- [ ] 没有 source group 出现在超过一个 split。
- [ ] `other` 包含与部门有关但公开的 near-miss examples。
- [ ] test split 在最终评估前保持 untouched。
