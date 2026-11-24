const ATTRIBUTION = /^(co-authored-by|claude-session):|generated with/im;

const config = {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "no-agent-attribution": ({ raw }) => [
          !ATTRIBUTION.test(raw ?? ""),
          'remove the Co-Authored-By, Claude-Session and "Generated with" lines: commits here carry no agent attribution (git commit --amend, or git rebase with reword)',
        ],
      },
    },
  ],
  rules: { "no-agent-attribution": [2, "always"] },
};
export default config;
