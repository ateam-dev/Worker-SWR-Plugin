# Contribution Guide

Thanks for considering contributing to this project!

If you're submitting an issue instead, please skip this document.

If your pull request is related to a typo or the documentation being unclear, please click on the relevant page's Edit button (pencil icon) and directly suggest a correction instead.

This project was made with your goodwill. The simplest way to give back is by starring and sharing it online.

Everyone is welcome regardless of personal background.

## Development process

First fork and clone the repository.

Install dependencies:
```bash
yarn install
```

Make sure everything is correctly setup with:
```bash
yarn test

# You can check the coverage report.
yarn test:coverage
```

## How to write commit messages

We use [Conventional Commit](https://www.conventionalcommits.org/en/v1.0.0/) messages to automate version management.

Most common commit message prefixes are:
- fix: which represents bug fixes, and generate a patch release.
- feat: which represents a new feature, and generate a minor release.

## How to create PR

Push to your forked repository and create a pull request for the original.

Please write detailed descriptions about the purpose and the outlines of the change.

Some members of the development team approves the execution of the test CI.  
They will also conduct a code review and comment on any requests for modifications, which you will be asked to respond to.