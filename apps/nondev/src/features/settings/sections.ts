import {
  Bot,
  Info,
  Laptop,
  Lock,
  type LucideIcon,
  Share2,
  ShieldCheck,
  SunMoon,
  Users,
  Wrench,
} from "lucide-react";

import { ADVANCED_MODE_LABEL } from "../../brand";
import type { SettingsSection } from "../../router";

export interface SectionMeta {
  readonly id: SettingsSection;
  readonly label: string;
  readonly summary: string;
  readonly icon: LucideIcon;
  readonly tone: "blue" | "green" | "orange" | "grey" | "red" | "purple";
}

// Shared by the Settings screen and the shell's window title, so a section's
// name is spelled once.
export const SECTIONS: ReadonlyArray<SectionMeta> = [
  {
    id: "assistants",
    label: "AI assistants",
    summary: "ChatGPT, Google, Claude",
    icon: Bot,
    tone: "blue",
  },
  {
    id: "autonomy",
    label: "Autonomy & safety",
    summary: "How much it does alone",
    icon: ShieldCheck,
    tone: "green",
  },
  {
    id: "family",
    label: "Family",
    summary: "A safer setup for a child",
    icon: Users,
    tone: "orange",
  },
  {
    id: "sharing",
    label: "Sharing & review",
    summary: "GitHub and reviewers",
    icon: Share2,
    tone: "purple",
  },
  {
    id: "mac",
    label: "Your Mac",
    summary: "This computer, remote access",
    icon: Laptop,
    tone: "grey",
  },
  {
    id: "appearance",
    label: "Appearance",
    summary: "Theme, light, dark",
    icon: SunMoon,
    tone: "orange",
  },
  { id: "privacy", label: "Privacy", summary: "What leaves this Mac", icon: Lock, tone: "green" },
  {
    id: "advanced",
    label: ADVANCED_MODE_LABEL,
    summary: "Developer interface",
    icon: Wrench,
    tone: "grey",
  },
  { id: "about", label: "About", summary: "Version and credits", icon: Info, tone: "blue" },
];

export function sectionLabel(section: SettingsSection): string {
  return SECTIONS.find((entry) => entry.id === section)?.label ?? section;
}
