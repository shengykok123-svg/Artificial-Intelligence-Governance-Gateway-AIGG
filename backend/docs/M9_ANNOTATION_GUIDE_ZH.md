# M9 数据标注规则与训练流程（中文版）

> English reference: [M9_ANNOTATION_GUIDE.md](M9_ANNOTATION_GUIDE.md)

## 目的

M9 的用途是识别英文文字中**未公开或内部的、与特定部门有关的敏感内容**。M9 不负责决定最终政策结果；当 M9 报告一个 `DEPT_CONFIDENTIAL` span 后，现有的 M3 policy engine 才决定该 prompt 应该 allow、redact、hold 或 deny。

本文件提出目标标签，并定义建立小型高质量（gold）dataset 的人工审核流程。Gold dataset 的意思是：每个例子都由人根据本规则审核和标注，而不是从网上抓文字后自动猜标签。

## 重要：目标 schema 与目前 scaffold 的区别

目前已提交的 M9 scaffold 使用旧的 topic schema：

```text
finance | hr | legal | engineering | other
```

这个 schema 只能识别主题，不能区分“公开财报”和“内部财务预测”。

**不要使用旧的四个部门标签来建立 production dataset。** 在开始真实训练前，需要先修改 M9 的 data validator、trainer 和 detector，使它支持下方的 target schema。在完成迁移前，repo 内的 synthetic data 只能用于验证 pipeline wiring，不能用来声明模型准确率。

## 标注单位与资料格式

每个例子应是一句完整英文句子，或一段可独立理解的短文字（通常一至三句）。提交到 Git 前，必须移除或替换真实个人资料、账号、secret 和客户名称。

```json
{"id":"fin-001","source_group":"synthetic-finance-01","text":"The unreleased Q4 forecast projects a RM 2 million shortfall.","label":"finance_confidential","rationale":"Unreleased internal financial forecast."}
```

- `id`：稳定且唯一的记录 ID。
- `source_group`：原始文件或生成 batch。来自同一个 source group 的所有记录只能放在一个 split。
- `text`：经过脱敏、给模型读取的英文文字。
- `label`：必须是下列其中一个 target label。
- `rationale`：人工标注理由。应保留在私人的 annotation source；trainer 不一定需要读取它。

## 目标标签

| Label | 何时使用 | 正例 | 不应使用于 |
| --- | --- | --- | --- |
| `finance_confidential` | 未公开的预算、预测、收入/利润数字、定价、融资、并购估值或内部财务决定。 | "The draft acquisition budget caps the offer at RM 4.2 million." | 已公开的年报或一般财务建议。 |
| `hr_confidential` | 可识别员工/合约员工资料、薪资、绩效、招聘决定、纪律、医疗、请假或未公开的人力规划。 | "Aisha's performance review recommends a below-expectations rating." | 公开的请假政策或一般求职建议。 |
| `legal_confidential` | 未公开合约条款、谈判、法律意见、纠纷、调查或 privileged strategy。 | "Counsel recommends settling before the draft claim is filed." | 公开的 terms of service 或一般合约法说明。 |
| `engineering_confidential` | 未公开 source code、系统架构、credentials、安全漏洞、未发布 roadmap 或内部技术事故细节。 | "The production API key is stored in the legacy payment service." | 公开 API 文件或刻意公开的 open-source code。 |
| `other` | 公开、一般性、假设性、已批准公开，或无法确认是内部资料的文字。即使文字在谈 finance、HR、legal 或 engineering，也可以是 `other`。 | "The company published its annual revenue in the investor report." | 明确包含以上敏感类别的内部文字。 |

这里的 `confidential` 是指依照团队 policy 的内部/未公开内容；**不是**只要一句话提到某个部门就自动算 confidential。

## 标注员决策规则

1. 阅读完整例子；如果有 source context，也一起阅读。
2. 先判断：这是非公开/内部、且 gateway 应 flag 的内容吗？如果不是，标 `other`。
3. 如果是，选择最直接负责该内容的部门。
4. 每个记录只用一个标签。若一句话含两个部门风险，选择该句最主要的风险；若两段内容可独立理解，应拆成两个例子。
5. 不要因为出现公司名称、finance word 或 technical term 就推定 confidential。文字没有足够依据时，标 `other`。
6. 真的无法判断时，在私人的 annotation sheet 标为 `needs_review`；两位 reviewer 解决前，不要写进 training JSONL。

### 边界例子

| Text | Label | 原因 |
| --- | --- | --- |
| "The CFO will present the unreleased cash-flow forecast on Friday." | `finance_confidential` | 内部预测。 |
| "The CFO presented annual results in a public earnings call." | `other` | 已公开披露。 |
| "Please update Jia Wei's salary adjustment in the payroll system." | `hr_confidential` | 可识别的薪资资料。 |
| "Our public careers page describes the interview process." | `other` | 公开、一般的 HR 内容。 |
| "The counterparty rejected clause 7 in the unexecuted supplier agreement." | `legal_confidential` | 未签署合约的谈判内容。 |
| "This open-source repository uses an MIT licence." | `other` | 公开技术/法律内容。 |
| "The staging database password is in the incident channel." | `engineering_confidential` | credentials/security information。 |
| "Use HTTPS to encrypt traffic." | `other` | 一般公开建议。 |

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
6. **整合。** 将预测的 `*_confidential` label 映射为 `DEPT_CONFIDENTIAL`，并去掉 suffix 后作为 `content_department`。`detect()` 必须返回 sentence offsets；M3 仍然是 policy decision-maker。
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

- [ ] `*_confidential` target schema 已迁移到 M9 code。
- [ ] 所有文字都是 English、已脱敏，并获准用于 repo。
- [ ] 每个记录在私人的 annotation source 中都有 label、rationale 和 source group。
- [ ] 两位 reviewer 已解决不同意见。
- [ ] 没有 source group 出现在超过一个 split。
- [ ] `other` 包含与部门有关但公开的 near-miss examples。
- [ ] test split 在最终评估前保持 untouched。
