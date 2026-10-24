import { describe, expect, it } from "vite-plus/test";

import {
  describeFamilyMatches,
  evaluateFamilyRequest,
  familyCommandMatches,
  isReadOnlyCommand,
} from "./family.ts";

const ROOT = "/Users/me/games/space";
const ids = (command: string) => familyCommandMatches(command).map((match) => match.rule.id);
const needsGrownUp = (command: string) =>
  evaluateFamilyRequest({ kind: "command", command }, { projectRoot: ROOT }).needsGrownUp;

describe("family rules — ordinary project work stays with the child", () => {
  it.each([
    "ls -la",
    "cat index.html",
    "npm run build",
    "pnpm test",
    "node game.js",
    "python3 game.py",
    "git status",
    "git add -A && git commit -m 'save'",
    "mkdir sprites",
    "echo hello > notes.txt",
  ])("%s", (command) => {
    expect(ids(command)).toEqual([]);
    expect(needsGrownUp(command)).toBe(false);
  });
});

describe("family rules — the internet and installs need a grown-up", () => {
  it.each([
    ["curl https://example.com", "uses-internet"],
    ["wget http://x.test/file.zip", "uses-internet"],
    ["git push origin my-branch", "uses-internet"],
    ["git clone https://github.com/a/b", "uses-internet"],
    ["git fetch", "uses-internet"],
    ["npm install left-pad", "installs-software"],
    ["pnpm add three", "installs-software"],
    ["yarn", "installs-software"],
    ["npx create-react-app game", "installs-software"],
    ["pnpm dlx cowsay hi", "installs-software"],
    ["pip install pygame", "installs-software"],
    ["python3 -m pip install pygame", "installs-software"],
    ["brew install sl", "installs-software"],
    ["cargo install ripgrep", "installs-software"],
    ["open https://youtube.com", "uses-internet"],
    ["sudo ls", "admin-rights"],
    ["bash -c 'cd x && npm i'", "installs-software"],
    ["echo $(curl -s https://x.test)", "uses-internet"],
  ])("%s → %s", (command, id) => {
    expect(ids(command)).toContain(id);
    expect(needsGrownUp(command)).toBe(true);
  });

  it("a web-search tool call needs a grown-up whatever its prompt says", () => {
    const result = evaluateFamilyRequest(
      { kind: "command", command: "Search for dinosaur facts", toolItemType: "web_search" },
      { projectRoot: ROOT },
    );
    expect(result.needsGrownUp).toBe(true);
    expect(result.family.map((match) => match.rule.id)).toEqual(["uses-internet"]);
  });

  it("anything a hard rule holds needs a grown-up too", () => {
    const deletes = evaluateFamilyRequest(
      { kind: "command", command: "rm -rf sprites" },
      { projectRoot: ROOT },
    );
    expect(deletes.needsGrownUp).toBe(true);
    expect(deletes.family).toEqual([]);
    const outside = evaluateFamilyRequest(
      {
        kind: "file-change",
        files: [{ path: "/Users/me/Documents/tax.pdf", operation: "change" }],
      },
      { projectRoot: ROOT },
    );
    expect(outside.needsGrownUp).toBe(true);
    expect(
      evaluateFamilyRequest(
        { kind: "file-change", files: [{ path: `${ROOT}/index.html`, operation: "change" }] },
        { projectRoot: ROOT },
      ).needsGrownUp,
    ).toBe(false);
    expect(evaluateFamilyRequest({ kind: "permission" }).needsGrownUp).toBe(true);
  });

  it("describes what it caught in a short phrase", () => {
    expect(describeFamilyMatches(familyCommandMatches("npm install x"))).toBe(
      "installs something and uses the internet",
    );
  });
});

// Seen live: a local check that only read the project, with "https://" in it as the text it
// was looking for, was held as "It uses the internet". Mentioning a web address is not
// going there; only network use needs a grown-up.
describe("family rules — a web address written as text is not the internet", () => {
  it.each([
    'grep -r "https://" .',
    "grep -rn 'http://' --include=*.html .",
    "rg 'http://'",
    "rg -l 'https?://' src | wc -l",
    `node -e "const fs=require('fs'); const s=fs.readFileSync('index.html','utf8'); console.log(s.includes('https://'))"`,
    `node -e "const s=require('fs').readFileSync('index.html','utf8'); console.log(/https?:\\/\\//.test(s) ? 'remote links left' : 'all local')"`,
    `python3 -c "s=open('index.html').read(); print('https://' in s)"`,
    `python3 -c "import re; print(re.findall(r'https://[^\\"]+', open('index.html').read()))"`,
    "cat > check.js <<'EOF'\nconst fs = require('fs');\nconst s = fs.readFileSync('index.html', 'utf8');\nif (s.includes('https://')) console.log('remote links left');\nEOF",
    "cat > check.js <<'EOF'\nconst s = require('fs').readFileSync('index.html', 'utf8');\nconsole.log(s.includes('https://') ? 'remote' : 'local');\nEOF\nnode check.js",
    "python3 - <<'EOF'\nhtml = open('index.html').read()\nprint('https://' in html)\nEOF",
    'echo "see https://example.com"',
    "printf 'Made with https://skycot.com\\n' >> credits.txt",
    'if grep -q "https://" index.html; then echo "remote links left"; else echo "all local"; fi',
    '! grep -rq "http://" .',
    'git commit -m "Swap https://cdn links for local copies"',
    'git log --oneline --grep "https://"',
    'find . -name "*.html" | xargs grep -l "https://"',
    "sed -i '' 's#https://cdn.example.com/#./vendor/#g' index.html",
    `/bin/zsh -lc "grep -rn \\"https://\\" index.html styles.css"`,
  ])("%s", (command) => {
    expect(ids(command)).toEqual([]);
    expect(needsGrownUp(command)).toBe(false);
  });
});

describe("family rules — real internet use still needs a grown-up", () => {
  it.each([
    "curl https://example.com",
    "curl -s https://x.test | grep title",
    "wget https://x.test/a.zip",
    "git clone https://github.com/a/b",
    "git pull",
    "npm install left-pad",
    "pnpm add three",
    "pip install requests",
    "brew install sl",
    "ssh pi@raspberrypi.local",
    "scp game.zip me@server.test:~",
    "rsync -a ./ me@server.test:site/",
    "nc example.com 80",
    "open https://example.com",
    "xdg-open https://example.com",
    `node -e "fetch('https://x.test').then(r => r.text()).then(console.log)"`,
    `node -e "require('https').get('https://x.test', r => r.pipe(process.stdout))"`,
    `node --input-type=module -e "import http from 'node:http'; http.get('http://x.test')"`,
    `node -e "require('child_process').execSync('curl https://x.test')"`,
    `node -e "require('child_process').execSync('npm install left-pad')"`,
    `node -e "eval(Buffer.from('ZmV0Y2g=', 'base64').toString())"`,
    `python -c "import urllib.request; urllib.request.urlopen('https://x')"`,
    `python3 -c "import requests; print(requests.get('https://x.test').text)"`,
    `python3 -c "import os; os.system('curl https://x.test')"`,
    `python3 -c "import subprocess; subprocess.run(['curl', 'x.test'])"`,
    `python3 -c "__import__('urllib.request').request.urlopen('https://x.test')"`,
    `deno eval "await fetch('https://x.test')"`,
    `ruby -e "require 'net/http'; puts Net::HTTP.get(URI('https://x.test'))"`,
    "python3 fetch_links.py https://x.test",
    "node scraper.js https://x.test",
    'echo "curl https://x.test" | sh',
    "echo https://x.test | xargs open",
    'grep -o "https://[^\\"]*" index.html | while read u; do echo "$u"; done',
    "echo 'curl https://x.test' > get.sh && bash get.sh",
    "cat > get.js <<'EOF'\nfetch('https://x.test').then(r => r.text()).then(console.log);\nEOF\nnode get.js",
    "cat <<'EOF' | bash\ncurl -s https://x.test\nEOF",
    "bash <<'EOF'\ncurl -s https://x.test\nEOF",
    "node <<'EOF'\nfetch('https://x.test')\nEOF",
    "cat <(curl -s https://x.test)",
    'echo "$(curl -s https://x.test)"',
    "if curl -fsS https://x.test > /dev/null; then echo up; fi",
    'eval "curl -s x.test"',
    `node -e "const get = fetch; get('https://x.test')"`,
    `node -e "require('ht' + 'tps').get('https://x.test')"`,
    "echo \"fetch('https://x.test')\" | node",
    "tee get.sh <<'EOF'\ncurl -s https://x.test\nEOF",
    "for u in https://a.test https://b.test; do echo $u; done",
  ])("%s", (command) => {
    expect(ids(command)).toContain("uses-internet");
    expect(needsGrownUp(command)).toBe(true);
  });

  it("a heredoc writing a script still catches network programs in it", () => {
    expect(ids("cat > get.sh <<'EOF'\ncurl -s https://x.test\nEOF")).toContain("uses-internet");
  });
});

describe("plan first — only looking around runs by itself while a plan is made", () => {
  it.each([
    "ls -la",
    "cat index.html",
    "head -n 40 game.js",
    "sed -n '1,200p' game.js",
    "rg score .",
    "grep -rn 'jump' src",
    "find . -name '*.js'",
    "git status",
    "git diff",
    "wc -l *.js",
    "cd src && ls",
    "ls 2>&1 | head",
    '/bin/zsh -lc "ls -la && cat index.html"',
  ])("%s only looks", (command) => {
    expect(isReadOnlyCommand(command)).toBe(true);
  });

  it.each([
    "echo hi > index.html",
    "cat a >> b",
    "cat > page.html <<'EOF'\n<p>hi</p>\nEOF",
    "sed -i '' 's/a/b/' game.js",
    "sed 's/a/b/w out' game.js",
    "find . -delete",
    "find . -exec rm {} ;",
    "sort -o out.txt in.txt",
    "rg --pre=./run.sh foo",
    "git push",
    "git commit -m save",
    "git diff --output=out.patch",
    "node game.js",
    "npm test",
    "mkdir sprites",
    "touch a.txt",
    "tee notes.txt",
    "ls &",
    "cat $(ls)",
    "cat `ls`",
    "FOO=1 ls",
    "xargs rm",
    "./ls",
    "",
  ])("%s is not just looking", (command) => {
    expect(isReadOnlyCommand(command)).toBe(false);
  });
});
