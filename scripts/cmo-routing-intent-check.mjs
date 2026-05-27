import assert from "node:assert/strict";
import { routeIntentForMessage, isReviewAuditIntent, isExplicitEchoExecutionIntent } from "../src/lib/cmo/app-routing-intent.ts";
import { isMixedCmoEchoRequest } from "../src/lib/cmo/echo-bridge.ts";

const longPlan = `Review plan ambassador này cho tôi:\n\nAmbassador Program includes X posts, content, creator campaign, referral reward logic, farming risk, and weekly tweet requirements.`;
assert.equal(routeIntentForMessage(longPlan), "cmo_review");
assert.equal(isReviewAuditIntent(longPlan), true);
assert.equal(isExplicitEchoExecutionIntent(longPlan), false);
assert.equal(isMixedCmoEchoRequest(longPlan), false);
assert.equal(routeIntentForMessage("Đánh giá ambassador program này giúp tôi"), "cmo_review");
assert.equal(routeIntentForMessage("Góp ý plan này rồi cho tôi điểm cần sửa"), "cmo_review");
assert.equal(routeIntentForMessage("Draft 3 X posts about Ambassador Program"), "echo_execution");
assert.equal(routeIntentForMessage("Rewrite ambassador plan này cho chuyên nghiệp hơn"), "cmo_default");
assert.equal(routeIntentForMessage("/x World App mini apps DeFi"), "surf_x");
assert.equal(routeIntentForMessage("Review plan after previous /x command mentioning X posts"), "cmo_review");
assert.equal(routeIntentForMessage("Review plan after previous /echo command mentioning content"), "cmo_review");
console.log("CMO routing intent checks passed");
