// SKYCOT's drawn characters for profile pictures (from the "Who's using SKYCOT?" Workshop
// mockup, option B, chosen by Mark on 25 Oct 2026). Static artwork shipped with the app: no
// photos for children, nothing loaded from anywhere.

export const AVATAR_CHARACTERS = [
  "cloud",
  "sun",
  "moon",
  "star",
  "rocket",
  "cat",
  "dog",
  "dino",
  "robot",
  "penguin",
  "fox",
  "owl",
  "whale",
  "unicorn",
  "octopus",
  "planet",
] as const;
export type AvatarCharacter = (typeof AVATAR_CHARACTERS)[number];

export const CHARACTER_ART: Readonly<
  Record<AvatarCharacter, { readonly viewBox: string; readonly body: string }>
> = {
  cloud: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <g transform="translate(1 6.8) scale(.5)"> <path fill="#0071E3" stroke-width="5" d="M25 84A18 18 0 0 1 25 48L27.181 48A25 25 0 0 1 68.406 26.136A23 23 0 0 1 102.872 48.421A18 18 0 0 1 99 84Z" /> <rect x="45" y="47" width="10" height="15" rx="5" fill="#fff" stroke="none" /> <rect x="69" y="47" width="10" height="15" rx="5" fill="#fff" stroke="none" /> </g> </g>',
  },
  sun: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <path d="M50 32h7M45 45l5 5M32 50v7M19 45l-5 5M14 32H7M19 19l-5-5M32 14V7M45 19l5-5" fill="none" stroke-width="3.2" /> <circle cx="32" cy="32" r="14" fill="#ffd84a" /> <circle cx="27" cy="29.5" r="2" fill="#3a2d22" stroke="none" /><circle cx="37" cy="29.5" r="2" fill="#3a2d22" stroke="none" /> <path d="M26.5 35.5q5.5 5 11 0" fill="none" /> <circle cx="22.5" cy="34.5" r="2.6" fill="#f08a9a" fill-opacity="0.55" stroke="none" /><circle cx="41.5" cy="34.5" r="2.6" fill="#f08a9a" fill-opacity="0.55" stroke="none" /> </g>',
  },
  moon: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <path d="M40 7C22 7 9 21 9 38C9 52 20 60 33 60C43 60 52 54 56 45C42 47 30 38 30 25C30 18 34 11 40 7Z" fill="#ffe27a" /> <circle cx="22" cy="40" r="2" fill="#3a2d22" stroke="none" /> <path d="M19 47q5 4 10 0" fill="none" /> <circle cx="17" cy="45" r="2.4" fill="#f08a9a" fill-opacity="0.55" stroke="none" /> <path d="M50 10l1.4 3.4 3.4 1.4-3.4 1.4L50 19.6l-1.4-3.4-3.4-1.4 3.4-1.4z" fill="#ffd84a" stroke-width="1.6" /> </g>',
  },
  star: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <polygon points="32,8 39,24 56.5,25.6 43.3,37.2 47.2,54.4 32,45.4 16.8,54.4 20.7,37.2 7.5,25.6 25,24" fill="#ffd84a" /> <circle cx="27" cy="32" r="2" fill="#3a2d22" stroke="none" /><circle cx="37" cy="32" r="2" fill="#3a2d22" stroke="none" /> <path d="M28 37.5q4 3.6 8 0" fill="none" /> <circle cx="23" cy="36" r="2.4" fill="#f08a9a" fill-opacity="0.55" stroke="none" /><circle cx="41" cy="36" r="2.4" fill="#f08a9a" fill-opacity="0.55" stroke="none" /> </g>',
  },
  rocket: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <path d="M22 33L11 49l11-4zM42 33l11 16-11-4z" fill="#e8557f" /> <path d="M27 48Q32 63 37 48z" fill="#ffa73b" /> <path d="M32 5C43 13 45 28 42 47H22C19 28 21 13 32 5Z" fill="#fffcf1" /> <path d="M32 5C37 9 40 14 41 19H23C24 14 27 9 32 5Z" fill="#e8557f" /> <circle cx="32" cy="29" r="6" fill="#7ec3f5" /> <path d="M29.5 27.5q1.5-1.5 3-1" stroke="#fff" stroke-width="1.8" fill="none" /> </g>',
  },
  cat: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <path d="M13 31L15 8l14 12zM51 31L49 8L35 20z" fill="#f2a65a" /> <path d="M17 17l1 8 6-5zM47 17l-1 8-6-5z" fill="#f4b9c0" stroke="none" /> <ellipse cx="32" cy="37" rx="21" ry="18" fill="#f2a65a" /> <path d="M32 20v5M26.5 21.5l1 4M37.5 21.5l-1 4" fill="none" /> <circle cx="24" cy="36" r="2.3" fill="#3a2d22" stroke="none" /><circle cx="40" cy="36" r="2.3" fill="#3a2d22" stroke="none" /> <path d="M29.5 41h5l-2.5 3z" fill="#e8557f" stroke-width="1.6" /> <path d="M32 44q-3 4-6.5 2M32 44q3 4 6.5 2" fill="none" /> <path d="M9 40l10 2M9 47l10-2M55 40l-10 2M55 47l-10-2" stroke-width="1.7" fill="none" /> </g>',
  },
  dog: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <path d="M17 17C7 20 6 38 11 47C18 46 20 31 21 22z" fill="#8a5a33" /> <path d="M47 17c10 3 11 21 6 30-7-1-9-16-10-25z" fill="#8a5a33" /> <ellipse cx="32" cy="34" rx="17" ry="19" fill="#dca66b" /> <ellipse cx="32" cy="44" rx="10.5" ry="8.5" fill="#fffcf1" /> <ellipse cx="32" cy="38.5" rx="4.6" ry="3.4" fill="#3a2d22" /> <circle cx="25" cy="29" r="2.3" fill="#3a2d22" stroke="none" /><circle cx="39" cy="29" r="2.3" fill="#3a2d22" stroke="none" /> <path d="M32 42v3M32 45q-3 3.5-6 1M32 45q3 3.5 6 1" fill="none" /> <path d="M30 47.5q2 7 4 0z" fill="#e8557f" stroke-width="1.5" /> </g>',
  },
  dino: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <path d="M16 27V11l12 9zM25 21L32 5l7 16zM36 20l12-9v16z" fill="#ffa73b" /> <circle cx="32" cy="37" r="21" fill="#7cc46b" /> <ellipse cx="32" cy="46" rx="12" ry="8.5" fill="#a9dd98" /> <circle cx="24" cy="33" r="2.5" fill="#3a2d22" stroke="none" /><circle cx="40" cy="33" r="2.5" fill="#3a2d22" stroke="none" /> <circle cx="28" cy="44" r="1.5" fill="#3a2d22" stroke="none" /><circle cx="36" cy="44" r="1.5" fill="#3a2d22" stroke="none" /> <path d="M25 50q7 5.5 14 0" fill="none" /> <path d="M29 51.5l1.3 3 1.5-2.5z" fill="#fff" stroke-width="1.3" /> <circle cx="19" cy="40" r="2.6" fill="#f08a9a" fill-opacity="0.55" stroke="none" /><circle cx="45" cy="40" r="2.6" fill="#f08a9a" fill-opacity="0.55" stroke="none" /> </g>',
  },
  robot: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <path d="M32 17V9" fill="none" /> <circle cx="32" cy="7" r="3.4" fill="#e8557f" /> <rect x="8" y="29" width="6" height="12" rx="2.5" fill="#8d9ba8" /> <rect x="50" y="29" width="6" height="12" rx="2.5" fill="#8d9ba8" /> <rect x="13" y="17" width="38" height="33" rx="9" fill="#b9c6d2" /> <rect x="18" y="52" width="28" height="8" rx="3" fill="#8d9ba8" /> <circle cx="24" cy="31" r="6" fill="#fff" /><circle cx="40" cy="31" r="6" fill="#fff" /> <circle cx="25" cy="32" r="2.6" fill="#3a2d22" stroke="none" /><circle cx="41" cy="32" r="2.6" fill="#3a2d22" stroke="none" /> <rect x="22" y="41" width="20" height="5.5" rx="2.7" fill="#fff" /> <path d="M28.5 41v5.5M35.5 41v5.5" stroke-width="1.6" fill="none" /> </g>',
  },
  penguin: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <path d="M16 33C8 40 8 50 14 52C19 48 19 40 19 36z" fill="#34445a" /> <path d="M48 33c8 7 8 17 2 19-5-4-5-12-5-16z" fill="#34445a" /> <ellipse cx="32" cy="34" rx="18" ry="24" fill="#34445a" /> <ellipse cx="32" cy="39" rx="12" ry="17" fill="#fffcf1" /> <circle cx="26" cy="24" r="4.4" fill="#fff" /><circle cx="38" cy="24" r="4.4" fill="#fff" /> <circle cx="27" cy="25" r="2" fill="#3a2d22" stroke="none" /><circle cx="37" cy="25" r="2" fill="#3a2d22" stroke="none" /> <path d="M27.5 30h9L32 37z" fill="#ffa73b" /> <ellipse cx="24" cy="58.5" rx="6.5" ry="2.8" fill="#ffa73b" /><ellipse cx="40" cy="58.5" rx="6.5" ry="2.8" fill="#ffa73b" /> </g>',
  },
  fox: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <path d="M8 12L24 23Q32 21 40 23L56 12L53 39Q45 58 32 58Q19 58 11 39Z" fill="#f08a3c" /> <path d="M13 19l8 5-6 7zM51 19l-8 5 6 7z" fill="#3a2d22" stroke="none" /> <path d="M12 40Q22 36 32 45Q42 36 52 40Q45 58 32 58Q19 58 12 40Z" fill="#fffcf1" /> <circle cx="23" cy="34" r="2.3" fill="#3a2d22" stroke="none" /><circle cx="41" cy="34" r="2.3" fill="#3a2d22" stroke="none" /> <ellipse cx="32" cy="53" rx="3.2" ry="2.5" fill="#3a2d22" /> <path d="M32 55.5v1.5" stroke-width="1.6" fill="none" /> </g>',
  },
  owl: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <path d="M13 20L10 5L25 14zM51 20L54 5L39 14z" fill="#8f6a47" /> <ellipse cx="32" cy="36" rx="21" ry="23" fill="#a87b52" /> <ellipse cx="32" cy="45" rx="12.5" ry="13" fill="#ecd7ae" /> <circle cx="23" cy="29" r="8.6" fill="#fffcf1" /><circle cx="41" cy="29" r="8.6" fill="#fffcf1" /> <circle cx="24.5" cy="30" r="3.6" fill="#3a2d22" stroke="none" /><circle cx="39.5" cy="30" r="3.6" fill="#3a2d22" stroke="none" /> <path d="M28.5 35h7L32 41.5z" fill="#ffa73b" /> <path d="M26 47q3 3 6 0q3 3 6 0M26 53q3 3 6 0q3 3 6 0" stroke-width="1.8" fill="none" /> </g>',
  },
  whale: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <path d="M27 20V12M27 12q-4-5-8-2M27 12q4-5 8-2" stroke="#4fa3e8" stroke-width="2.6" fill="none" /> <path d="M46 40C54 40 57 34 56 24C61 25 63 32 61 38C60 44 54 49 47 47z" fill="#4fa3e8" /> <path d="M4 38C4 26 15 19 28 21C40 23 50 30 50 41C50 51 41 55 30 55C15 55 4 51 4 38Z" fill="#4fa3e8" /> <path d="M8 44C16 50 36 51 48 45C46 52 39 55 30 55C18 55 9 52 8 44Z" fill="#d3ebfb" stroke="none" /> <path d="M4 38C4 26 15 19 28 21C40 23 50 30 50 41C50 51 41 55 30 55C15 55 4 51 4 38Z" fill="none" /> <circle cx="17" cy="35" r="2.3" fill="#3a2d22" stroke="none" /> <path d="M8 43q6 4 12 1" fill="none" /> <circle cx="23" cy="42" r="2.6" fill="#f08a9a" fill-opacity="0.55" stroke="none" /> </g>',
  },
  unicorn: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <path d="M19 25Q5 31 8 44Q7 54 16 58Q12 46 18 37z" fill="#e0a0e0" /> <path d="M45 25Q59 31 56 44Q57 54 48 58Q52 46 46 37z" fill="#8fc7f5" /> <path d="M20 24L22 10L31 20zM44 24L42 10L33 20z" fill="#fffcf1" /> <path d="M32 3L27.5 22H36.5z" fill="#ffd84a" /> <path d="M29.6 12l5.4 1.8M28.6 17l7.2 2.2" stroke-width="1.6" fill="none" /> <path d="M19 38C19 27 24 21 32 21C40 21 45 27 45 38C45 49 41 58 32 58C23 58 19 49 19 38Z" fill="#fffcf1" /> <path d="M32 21Q22 19 21 29Q27 25 32 27z" fill="#e0a0e0" /> <ellipse cx="32" cy="52" rx="7.5" ry="5" fill="#fbd5e0" /> <circle cx="29.2" cy="52" r="1.2" fill="#3a2d22" stroke="none" /><circle cx="34.8" cy="52" r="1.2" fill="#3a2d22" stroke="none" /> <path d="M23.5 38q3 3 6 0M34.5 38q3 3 6 0" fill="none" /> <circle cx="24" cy="44.5" r="2.4" fill="#f08a9a" fill-opacity="0.55" stroke="none" /><circle cx="40" cy="44.5" r="2.4" fill="#f08a9a" fill-opacity="0.55" stroke="none" /> </g>',
  },
  octopus: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <path d="M13 32C9 46 6 53 12 58C16 58 16 51 19 47C21 54 23 58 28 58C33 58 30 51 32 47C34 51 31 58 36 58C41 58 43 54 45 47C48 51 48 58 52 58C58 53 55 46 51 32z" fill="#b48ae0" /> <path d="M32 6C21 6 13 14 13 25C13 34 21 40 32 40C43 40 51 34 51 25C51 14 43 6 32 6Z" fill="#b48ae0" /> <circle cx="25" cy="25" r="2.4" fill="#3a2d22" stroke="none" /><circle cx="39" cy="25" r="2.4" fill="#3a2d22" stroke="none" /> <path d="M27 31q5 4.5 10 0" fill="none" /> <circle cx="20" cy="30" r="2.6" fill="#f08a9a" fill-opacity="0.55" stroke="none" /><circle cx="44" cy="30" r="2.6" fill="#f08a9a" fill-opacity="0.55" stroke="none" /> <circle cx="24" cy="14" r="2" fill="#d9c0f2" stroke="none" /><circle cx="33" cy="12" r="1.5" fill="#d9c0f2" stroke="none" /> </g>',
  },
  planet: {
    viewBox: "0 0 64 64",
    body: '<g stroke="#3a2d22" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"> <g transform="rotate(-18 32 32)"> <ellipse cx="32" cy="32" rx="28" ry="8" fill="none" stroke-width="9" /> <ellipse cx="32" cy="32" rx="28" ry="8" fill="none" stroke="#ffd84a" stroke-width="4.6" /> </g> <circle cx="32" cy="32" r="15" fill="#f2a65a" /> <g transform="rotate(-18 32 32)"> <path d="M4 32A28 8 0 0 0 60 32" fill="none" stroke-width="9" /> <path d="M4 32A28 8 0 0 0 60 32" fill="none" stroke="#ffd84a" stroke-width="4.6" /> </g> <circle cx="27" cy="26" r="2" fill="#3a2d22" stroke="none" /><circle cx="37" cy="26" r="2" fill="#3a2d22" stroke="none" /> <path d="M27.5 30.5q4.5 3 9 0" fill="none" /> </g>',
  },
};

export const CHARACTER_NAMES: Readonly<Record<AvatarCharacter, string>> = {
  cloud: "Cloud",
  sun: "Sun",
  moon: "Moon",
  star: "Star",
  rocket: "Rocket",
  cat: "Cat",
  dog: "Dog",
  dino: "Dino",
  robot: "Robot",
  penguin: "Penguin",
  fox: "Fox",
  owl: "Owl",
  whale: "Whale",
  unicorn: "Unicorn",
  octopus: "Octopus",
  planet: "Planet",
};
