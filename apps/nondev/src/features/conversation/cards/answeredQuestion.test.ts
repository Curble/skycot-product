import { describe, expect, it } from "vite-plus/test";

import { answeredQuestionNote } from "./answeredQuestion";

describe("answered question notes", () => {
  it("keeps the question and the child's answer in kid words", () => {
    expect(answeredQuestionNote("Which colour should I use?", { Colour: "blue" })).toEqual({
      asked: "You asked Sam: Which colour should I use?",
      answered: "You answered: blue",
    });
  });
});
