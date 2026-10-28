# 1. Install and setup

Install [OMP](https://github.com/can1357/oh-my-pi), then add the public plugin:

```sh
omp plugin marketplace add misty-step/mistystack
omp plugin install --scope user mistystack@mistystack
```

Start a new OMP session and ask it to use `setup-mistystack`. [Setup](../../skills/setup-mistystack/SKILL.md) finds your accessible models, asks for your budget, and writes each rigor role to OMP's own config. It also connects those roles to OMP task agents. Credentials stay in OMP's credential system.

To update:

```sh
omp plugin marketplace update mistystack
omp plugin upgrade --scope user mistystack@mistystack
```

Start a new session after upgrading. Re-run setup when changing models or budgets. A catalog refresh alone does not upgrade an installed plugin.

Next: [Misty](02-misty.md).
