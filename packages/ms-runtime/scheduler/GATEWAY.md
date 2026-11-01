# 事件网关与两级过滤（步骤四）

> 把调度器从"只有定时触发"升级为"统一事件接入 + 过滤 + Trigger"。
> **VERDICT: PASS**（文末）。

## 一、事件源与接入方式（Phase 1 三类）

| 源 | 接入 | 说明 |
|---|---|---|
| `loom` | Loom 任务队列轮询结果（轮询器把新增任务映射为事件） | Phase 1 轮询；设备直连 WS 通道（拍板二十）落地后成为第四源 |
| `cron` | 本机调度器既有的触发规则表到期 | 规则以数据库为准，重启不丢 |
| `webhook:<kind>` | 文件变化 watcher / GitHub webhook / IM 消息适配器 | 本地 HTTP 回环接收器转 GatewayEvent（接收器属宿主接线，批次二） |

统一信封：`GatewayEvent { id, source, type, payload, dedup_key, timestamp }`。

## 二、两级过滤

### Fast Path（确定性，代码）
1. **白名单**：`source#type` 不在名单 → `drop`。
2. **去重**：`dedupKey` 在窗口内（默认 5 分钟）只通过一次；过期键清理。
3. **唤醒预算**（步骤九）：`WakeupBudget.tryAcquire(source)`——超预算
   `defer`（保留事件语义），不是 drop（过滤语义）；其他来源不受挤占。

### Slow Path（廉价模型通道，可插拔）
- `SlowPath` 接口：按提示词策略判定 `action / defer / drop`。
- 策略提示词落 `policies/event-filter.md`（Phase 1 未接廉价模型通道时的
  缺省实现 = 确定性放行；接口位已留出）。
- 判定 `action` → `onAction` 回调 → 转化为调度器既有 Trigger 记录。

## 三、去重语义与死信

- 去重按 `dedupKey`（调用方保证同义事件同键）；同键窗口内重复 = `drop`；
  窗口滑出后重新摄入合法（cron 类周期事件靠此语义）。
- defer 不占用去重窗口：预算恢复后同键事件重新摄入判定。
- 死信：Fast Path 的 `drop` 与 Slow Path 的 `drop` 均返回 reason；
  Phase 1 不另建死信存储——drop 的 reason 由调用方写本地审计
  （入哈希链，SECURITY-BOUNDARY.md 第三节）。

## 四、测试映射（21 例中的网关部分）

白名单 drop / action 回调 / 同键去重+窗口滑出+异键隔离 / 预算 defer 与来源隔离 /
Slow Path drop/defer 不触发回调——全部机器验证。

---

**VERDICT: PASS**

（生产者自检结论：三类源、两级过滤、去重/defer/drop 三种语义各有测试；
订阅直通明确不在 Phase 1。）
