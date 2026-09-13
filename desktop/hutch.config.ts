export default {
  electrobun: { version: "2.0.1" },
  scripts: {
    install: ["hutch", "install", "--frozen-lockfile"],
    dev: ["hutch", "electrobun", "dev", "--watch"],
    build: ["hutch", "electrobun", "build", "--env=stable"],
  },
};
