import type { FileKind } from "@t3tools/skycot-rules/browse";
import {
  AppWindow,
  File,
  FileCode2,
  FileText,
  Film,
  Folder,
  Image,
  Music,
  Palette,
  type LucideIcon,
} from "lucide-react";

/** One line icon per kind of file, SF-Symbols style. */
export const KIND_ICON: Readonly<Record<FileKind, LucideIcon>> = {
  folder: Folder,
  page: AppWindow,
  picture: Image,
  style: Palette,
  document: FileText,
  code: FileCode2,
  sound: Music,
  video: Film,
  other: File,
};
