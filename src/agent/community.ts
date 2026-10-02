import { z } from "zod";
import { guessLanguage } from "@/domain/text";
import { renderClientBrief, type ClientContext } from "./context";
import type { LLM } from "./llm";
import { COMMUNITY, identity } from "./prompts";

export const TriageSchema = z.object({
  category: z.enum(["question", "praise", "lead", "complaint", "spam", "sensitive", "other"]),
  sentiment: z.enum(["positive", "neutral", "negative"]),
  language: z.string().describe("ISO 639-1 of the message"),
  action: z.enum(["reply", "hide", "escalate", "ignore"]),
  reply: z.string().describe("Reply text (holding reply when escalating); empty for hide/ignore"),
  needsYouReason: z.string().describe("Why the owner must look, or empty"),
});
export type Triage = z.infer<typeof TriageSchema>;

export interface TriageInput {
  ctx: ClientContext;
  playbook: string;
  item: {
    platform: string;
    kind: "comment" | "dm" | "mention";
    authorName?: string | null;
    text: string;
    postTitle?: string | null;
    postCaption?: string | null;
    thread?: Array<{ from: "them" | "us"; text: string }>;
  };
}

const SPAM = /(crypto|bitcoin|forex|investment opportunity|dm (this|our) account|promote (it|your page) on|collab\?? dm|free followers|giveaway winner|click the link in (my|our) bio to claim)/i;
const SENSITIVE = /(lawyer|lawsuit|sue|court|refund|scam|police|press|journalist|reporter|threat|kill|hurt|unsafe|harass)/i;

export async function triageMessage(llm: LLM, input: TriageInput): Promise<Triage> {
  return llm.structured({
    task: "community.triage",
    clientId: input.ctx.client.id,
    system: [
      { text: `${identity()}\n\n${COMMUNITY}\n\n<playbook>\n${input.playbook}\n</playbook>`, cache: true },
      { text: renderClientBrief(input.ctx), cache: true },
    ],
    prompt: `<message platform="${input.item.platform}" kind="${input.item.kind}" author="${input.item.authorName ?? "unknown"}">
${input.item.text}
</message>
${input.item.postTitle ? `On post: "${input.item.postTitle}"` : ""}
${input.item.postCaption ? `Post caption: ${input.item.postCaption.slice(0, 600)}` : ""}
${input.item.thread?.length ? `Earlier in this conversation:\n${input.item.thread.map((t) => `${t.from === "us" ? "Us" : "Them"}: ${t.text}`).join("\n")}` : ""}`,
    schema: TriageSchema,
    effort: "low",
    maxTokens: 4000,
    demo: () => demoTriage(input),
  });
}

/** Rule-based stand-in used in demo mode (and as a sanity floor in tests). */
export function demoTriage(input: TriageInput): Triage {
  const text = input.item.text;
  const language = guessLanguage(text);
  const name = input.item.authorName?.split(" ")[0];
  if (SPAM.test(text)) return { category: "spam", sentiment: "neutral", language, action: "hide", reply: "", needsYouReason: "" };
  if (SENSITIVE.test(text)) {
    return {
      category: "sensitive",
      sentiment: "negative",
      language,
      action: "escalate",
      reply: language === "fa" ? "از اینکه مطرح کردید ممنونیم — امروز مستقیم با شما در تماس خواهیم بود." : "Thank you for raising this — we'll follow up with you directly today.",
      needsYouReason: "Mentions legal/refund/safety/press topics.",
    };
  }
  const isQuestion = /\?|؟|how much|price|cost|available|book|قیمت|چطور/i.test(text);
  if (isQuestion) {
    return {
      category: /price|cost|how much|قیمت/i.test(text) ? "lead" : "question",
      sentiment: "neutral",
      language,
      action: "reply",
      reply:
        language === "fa"
          ? `${name ? `${name} عزیز، ` : ""}ممنون از سوالتان! جزئیات را در دایرکت برایتان می‌فرستیم.`
          : `${name ? `Thanks ${name}! ` : "Thanks for asking! "}Sending you the details in DMs now.`,
      needsYouReason: "",
    };
  }
  return {
    category: "praise",
    sentiment: "positive",
    language,
    action: "reply",
    reply: language === "fa" ? "خیلی ممنون! خوشحالیم که دوستش داشتید 🤍" : `${name ? `Thank you ${name}` : "Thank you"} — that means a lot to the whole crew 🤍`,
    needsYouReason: "",
  };
}
