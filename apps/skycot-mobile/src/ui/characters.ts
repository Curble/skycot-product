/**
 * SKYCOT's drawn characters for profile pictures, as pictures the phone can show (no drawing
 * library here). Made from the same artwork as the Mac (nondev features/family/characters.ts)
 * into nondev/brand/assets/characters; static, shipped with the app, nothing loaded from anywhere.
 */
import type { ImageSourcePropType } from "react-native";

import type { AvatarCharacter } from "../../../nondev/src/features/family/characters";

export const CHARACTER_PICTURES: Readonly<Record<AvatarCharacter, ImageSourcePropType>> = {
  cloud: require("../../../../nondev/brand/assets/characters/cloud-192.png"),
  sun: require("../../../../nondev/brand/assets/characters/sun-192.png"),
  moon: require("../../../../nondev/brand/assets/characters/moon-192.png"),
  star: require("../../../../nondev/brand/assets/characters/star-192.png"),
  rocket: require("../../../../nondev/brand/assets/characters/rocket-192.png"),
  cat: require("../../../../nondev/brand/assets/characters/cat-192.png"),
  dog: require("../../../../nondev/brand/assets/characters/dog-192.png"),
  dino: require("../../../../nondev/brand/assets/characters/dino-192.png"),
  robot: require("../../../../nondev/brand/assets/characters/robot-192.png"),
  penguin: require("../../../../nondev/brand/assets/characters/penguin-192.png"),
  fox: require("../../../../nondev/brand/assets/characters/fox-192.png"),
  owl: require("../../../../nondev/brand/assets/characters/owl-192.png"),
  whale: require("../../../../nondev/brand/assets/characters/whale-192.png"),
  unicorn: require("../../../../nondev/brand/assets/characters/unicorn-192.png"),
  octopus: require("../../../../nondev/brand/assets/characters/octopus-192.png"),
  planet: require("../../../../nondev/brand/assets/characters/planet-192.png"),
};
