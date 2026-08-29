import {
  Blocks,
  Bot,
  Factory,
  Goal,
  Hammer,
  Landmark,
  MessageCircle,
  MessagesSquare,
  Network,
  ScrollText,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";

export const kernelNav = [
  { id: "overview", label: "Overview", icon: Network },
  { id: "people", label: "People", icon: UserRound },
  { id: "workers", label: "Workers", icon: Bot },
  { id: "work", label: "Work", icon: Hammer },
  { id: "records", label: "Records", icon: ScrollText },
] as const;

export const moduleNav = [
  { id: "command", label: "Command Bridge", icon: MessageCircle },
  { id: "opportunities", label: "Opportunities", icon: Sparkles },
  { id: "goals", label: "Goals", icon: Goal },
  { id: "tasks", label: "Tasks", icon: ShieldCheck },
  { id: "finance", label: "Finance", icon: Landmark },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "conversations", label: "Conversations", icon: MessagesSquare },
  { id: "admin", label: "Admin", icon: Blocks },
  { id: "factory", label: "Factory", icon: Factory },
] as const;

export type PageId =
  (typeof kernelNav)[number]["id"] | (typeof moduleNav)[number]["id"];

export function isPageId(value: string): value is PageId {
  return [...kernelNav, ...moduleNav].some((item) => item.id === value);
}
