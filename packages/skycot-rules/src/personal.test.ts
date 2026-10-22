import { describe, expect, it } from "vite-plus/test";

import {
  describePersonalCategories,
  findPersonalDetails,
  hiddenPlaceholder,
  personalCategories,
  redactPersonalDetails,
  rewriteWithNicknames,
  type PersonalCategory,
} from "./personal.ts";

const categories = (text: string) => personalCategories(findPersonalDetails(text));
const caught = (text: string) => findPersonalDetails(text).map((detail) => detail.text);

describe("personal details — the showpiece sentence", () => {
  const sentence = "my name is Ava Smith and I go to St Kilda Primary";

  it("finds the full name and the school, nothing else", () => {
    expect(findPersonalDetails(sentence).map(({ category, text }) => ({ category, text }))).toEqual(
      [
        { category: "full-name", text: "Ava Smith" },
        { category: "school", text: "St Kilda Primary" },
      ],
    );
  });

  it("offers a one-tap nickname rewrite", () => {
    expect(rewriteWithNicknames(sentence)).toBe("my name is Ava and I go to school");
  });

  it("gives offsets that slice back to the detail", () => {
    for (const detail of findPersonalDetails(sentence)) {
      expect(sentence.slice(detail.start, detail.end)).toBe(detail.text);
    }
  });

  it("says what it found in words", () => {
    expect(describePersonalCategories(categories(sentence))).toBe(
      "a full name and a school's name",
    );
  });
});

describe("personal details — true positives", () => {
  it.each<[string, PersonalCategory, string]>([
    // Full names, however a child types them.
    ["My name is Ava Smith", "full-name", "Ava Smith"],
    ["my name is ava smith and i like cats", "full-name", "ava smith"],
    ["my full name is Leo James Nguyen", "full-name", "Leo James Nguyen"],
    ["I'm Noah Williams", "full-name", "Noah Williams"],
    ["i am mia jones", "full-name", "mia jones"],
    ["make a birthday card for Olivia Brown", "full-name", "Olivia Brown"],
    ["my mum is Jane Patel", "full-name", "Jane Patel"],
    ["my teacher is called Sam O'Brien", "full-name", "Sam O'Brien"],
    ["say hi to Mrs Brown", "full-name", "Mrs Brown"],
    ["this is Zara McDonald", "full-name", "Zara McDonald"],
    // Schools.
    ["I go to St Kilda Primary", "school", "St Kilda Primary"],
    ["i go to st kilda primary", "school", "st kilda primary"],
    ["a poster for Sunnyvale High School's fete", "school", "Sunnyvale High School"],
    ["my school is called brighton grammar", "school", "brighton grammar"],
    ["We won at Little River Primary School", "school", "Little River Primary School"],
    ["she attends Melbourne Girls College", "school", "Melbourne Girls College"],
    // Where someone lives.
    ["I live at 12 Smith Street", "address", "12 Smith Street"],
    ["come to 4/27 Acland St.", "address", "4/27 Acland St"],
    ["our house is 7 wattle crescent", "address", "7 wattle crescent"],
    ["I live on Fitzroy Street", "address", "Fitzroy Street"],
    ["St Kilda VIC 3182", "address", "St Kilda VIC 3182"],
    ["we are in Richmond, Vic 3121", "address", "Richmond, Vic 3121"],
    ["my postcode is 3182", "address", "3182"],
    ["I live in St Kilda", "address", "St Kilda"],
    ["i live in brunswick east", "address", "brunswick east"],
    ["Springfield, IL 62704", "address", "Springfield, IL 62704"],
    ["London SW1A 1AA", "address", "SW1A 1AA"],
    ["my address is 5 the avenue, hobart", "address", "5 the avenue, hobart"],
    // Phone numbers.
    ["call 0412 345 678", "phone", "0412 345 678"],
    ["my number is 0412345678", "phone", "0412345678"],
    ["ring (03) 9123 4567 tonight", "phone", "(03) 9123 4567"],
    ["+61 412 345 678", "phone", "+61 412 345 678"],
    ["+44 20 7946 0958", "phone", "+44 20 7946 0958"],
    ["call me on 9123 4567", "phone", "9123 4567"],
    ["1800 123 456", "phone", "1800 123 456"],
    ["(555) 123-4567", "phone", "(555) 123-4567"],
    // Email.
    ["email me at ava.smith@example.com", "email", "ava.smith@example.com"],
    // Birthdays, and an age beside a full name.
    ["my birthday is 3 March", "birthday", "3 March"],
    ["my birthday is on the 3rd of March 2016", "birthday", "3rd of March 2016"],
    ["I was born on 12/03/2015", "birthday", "12/03/2015"],
    ["born in 2016", "birthday", "2016"],
    ["Ava Smith is 8 years old", "birthday", "8 years old"],
    // Usernames and passwords.
    ["my password is dragon123", "login", "dragon123"],
    ["password: hunter2", "login", "hunter2"],
    ["my roblox username is AvaRocks", "login", "AvaRocks"],
    ["my pin is 4321", "login", "4321"],
  ])("%s → %s", (text, category, detail) => {
    const found = findPersonalDetails(text).find((entry) => entry.category === category);
    expect(found?.text).toBe(detail);
  });

  it("finds several details in one message, in reading order", () => {
    expect(
      categories(
        "Hi I'm Ava Smith, I'm 8 years old, I live at 12 Smith Street St Kilda VIC 3182, call 0412 345 678 or ava@example.com",
      ),
    ).toEqual(["full-name", "address", "phone", "email", "birthday"]);
  });

  it("rewrites every catch with its stand-in", () => {
    expect(rewriteWithNicknames("I live at 12 Smith Street and my number is 0412 345 678")).toBe(
      "I live at my street and my number is my phone number",
    );
    expect(rewriteWithNicknames("my password is dragon123")).toBe("my password is a secret");
    expect(rewriteWithNicknames("say hi to Mrs Brown")).toBe("say hi to Mrs B.");
  });
});

describe("personal details — false positives stay quiet", () => {
  it.each([
    // A first name on its own is fine; it is what SKYCOT already calls the child.
    "Mia",
    "Make a game where Mia finds a dragon",
    "my name is Ava",
    "I'm Ava and I love horses",
    // Planets, stories, made-up and famous people.
    "Make a page about Mars",
    "I live on Mars",
    "I live in a castle",
    "I live in Australia",
    "The dragon flew down Main Street",
    "The shop on Main Street sells cake",
    "Harry Potter goes to Hogwarts School",
    "A fan page for Taylor Swift",
    "Max Power mode unlocked",
    "Ruby Slippers and a Rose Garden",
    "Grace Church bake sale",
    // School words that are not a school's name.
    "I go to school on the bus",
    "Art School drawing game",
    "Welcome Back To School banner",
    "make it look old school",
    // Maths and numbers.
    "what is 123 + 456",
    "123",
    "12 + 34 = 46",
    "score 3000 points to win",
    "Level 12 has 1000000 coins",
    "the year 2025",
    "set the timer to 10 minutes",
    "make 3 big road signs",
    "draw 5 trees on the street",
    "turn 3 red cars into a race",
    // Games and passwords in stories.
    "a secret door that opens when the password is banana",
    "the login button is broken",
    "make a button that says Click Me",
    "It's my birthday party on the page",
    "make a birthday cake with 8 candles",
    "I am 8 years old",
    "Happy Birthday",
  ])("%s", (text) => {
    expect(caught(text)).toEqual([]);
  });
});

describe("personal details — the engine's redaction", () => {
  it("hides each detail and reports only the kinds", () => {
    const redaction = redactPersonalDetails("my name is Ava Smith and I go to St Kilda Primary");
    expect(redaction.text).toBe(
      `my name is ${hiddenPlaceholder("full-name")} and I go to ${hiddenPlaceholder("school")}`,
    );
    expect(redaction.categories).toEqual(["full-name", "school"]);
    expect(JSON.stringify(redaction.categories)).not.toContain("Ava");
  });

  it("leaves ordinary text untouched", () => {
    const text = "Change the footer text on index.html to say Made with SKYCOT";
    expect(redactPersonalDetails(text)).toEqual({ text, categories: [] });
  });

  it("names a photo for the picture check", () => {
    expect(describePersonalCategories(["photo"])).toBe("a photo of a person");
  });
});
