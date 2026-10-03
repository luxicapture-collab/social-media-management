import { Bell, BookOpen, CalendarDays, ChartLine, CheckSquare, Clapperboard, Home, Inbox, MessageSquare, Settings, Users } from "lucide-react";

/** Navigation shared by the sidebar (client) and the phone "More" screen (server). */
export const NAV_ITEMS = [
  { href: "/", label: "Today", Icon: Home, key: null },
  { href: "/studio", label: "Studio", Icon: Clapperboard, key: null },
  { href: "/approvals", label: "Approvals", Icon: CheckSquare, key: "approvals" },
  { href: "/calendar", label: "Calendar", Icon: CalendarDays, key: null },
  { href: "/analytics", label: "Analytics", Icon: ChartLine, key: null },
  { href: "/inbox", label: "Inbox", Icon: Inbox, key: "inbox" },
  { href: "/alerts", label: "Alerts", Icon: Bell, key: "alerts" },
  { href: "/clients", label: "Clients", Icon: Users, key: null },
  { href: "/chat", label: "Ask the agent", Icon: MessageSquare, key: null },
  { href: "/playbooks", label: "Playbooks", Icon: BookOpen, key: null },
  { href: "/settings", label: "Settings", Icon: Settings, key: null },
] as const;

/** Everything not in the phone's bottom tab bar. */
export const MORE_LINKS = NAV_ITEMS.filter((i) => !["/", "/approvals", "/studio", "/inbox"].includes(i.href));
