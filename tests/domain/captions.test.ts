import { describe, expect, it } from "vitest";
import { extractHashtags, findCliches, hasBlockingIssues, validateCaption, xWeightedLength } from "@/domain/captions";

describe("xWeightedLength", () => {
  it("counts URLs as 23 and emoji as 2", () => {
    expect(xWeightedLength("hello")).toBe(5);
    expect(xWeightedLength("see https://example.com/a/very/long/path?x=1")).toBe(4 + 23);
    expect(xWeightedLength("🎬")).toBe(2);
  });

  it("counts Persian letters as 1 like Latin", () => {
    expect(xWeightedLength("سلام")).toBe(4);
  });

  it("counts CJK as 2", () => {
    expect(xWeightedLength("映画")).toBe(4);
  });
});

describe("extractHashtags", () => {
  it("finds Latin and Persian hashtags but not URL fragments", () => {
    expect(extractHashtags("Love it #weddingfilm #عروسی see https://x.com/#nope")).toEqual(["#weddingfilm", "#عروسی"]);
  });
});

describe("validateCaption", () => {
  it("blocks more than five Instagram hashtags", () => {
    const issues = validateCaption("instagram", "A hook line\n\n#a #b #c #d #e #f", { format: "reel" });
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues.map((i) => i.code)).toContain("too_many_hashtags");
  });

  it("warns when the Instagram hook runs past the fold", () => {
    const long = "x".repeat(140);
    const issues = validateCaption("instagram", `${long}\nrest`, { format: "post" });
    expect(issues.map((i) => i.code)).toContain("hook_past_fold");
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("errors on X posts over 280 weighted characters unless premium", () => {
    const text = "a".repeat(281);
    expect(hasBlockingIssues(validateCaption("x", text, { format: "post" }))).toBe(true);
    expect(hasBlockingIssues(validateCaption("x", text, { format: "post", xPremium: true }))).toBe(false);
  });

  it("flags links in LinkedIn body and X link cost", () => {
    expect(validateCaption("linkedin", "Insight first.\nhttps://luxi.example", { format: "post" }).map((i) => i.code)).toContain("link_in_body");
    expect(validateCaption("x", "Read https://luxi.example", { format: "post" }).map((i) => i.code)).toContain("x_link_cost");
  });

  it("flags clichés", () => {
    expect(findCliches("Elevate your wedding with our game-changer films")).toEqual(["elevate your", "game-changer"]);
    expect(validateCaption("facebook", "Unlock the magic of film", { format: "post" }).map((i) => i.code)).toContain("cliche");
  });

  it("treats stories as captionless", () => {
    expect(validateCaption("instagram", "", { format: "story" })).toEqual([]);
    expect(validateCaption("instagram", "some text", { format: "story" })[0].code).toBe("story_caption");
  });
});
