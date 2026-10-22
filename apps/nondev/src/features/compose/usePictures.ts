import { useState } from "react";

import { randomUUID } from "~/lib/utils";

import { choosePictures, readPicture, toUploadAttachment, type PictureDraft } from "./pictures";

/** The pictures waiting to go with the next message in one composer. */
export function usePictures() {
  const [pictures, setPictures] = useState<ReadonlyArray<PictureDraft>>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const add = async (files: ReadonlyArray<File>) => {
    const { accepted, problem: left } = choosePictures(files, pictures.length);
    setProblem(left);
    const read = await Promise.allSettled(
      accepted.map((index) => readPicture(files[index]!, randomUUID())),
    );
    const drafts = read.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    if (drafts.length < accepted.length) setProblem("A picture couldn't be read. Try another one.");
    if (drafts.length > 0) setPictures((current) => [...current, ...drafts]);
  };

  return {
    pictures,
    problem,
    add: (files: ReadonlyArray<File>) => void add(files),
    remove: (id: string) =>
      setPictures((current) => current.filter((picture) => picture.id !== id)),
    clear: () => {
      setPictures([]);
      setProblem(null);
    },
    dismissProblem: () => setProblem(null),
    uploads: () => pictures.map(toUploadAttachment),
  };
}
