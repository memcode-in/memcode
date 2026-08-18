<div align="center">
  <!-- Replace this URL with your logo or banner -->
  <img width="2442" height="805" alt="image" src="https://github.com/user-attachments/assets/fbd83c2a-a93d-4b58-b0fa-f98a74f71cdb" />

</div>

<div align="center">

  <p><strong>End-to-end memory infrastructure for AI.</strong></p>

  <p>
    Give agents, copilots, applications, and workflows persistent memory that
    survives sessions, context windows, and model changes.
  </p>

  <img src="https://img.shields.io/badge/Memory-End--to--End-7C3AED" alt="End-to-end Memory"/>
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19"/>
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white" alt="TypeScript"/>
  <br/>
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white" alt="Vite"/>
  <img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare"/>
  <img src="https://img.shields.io/badge/Status-Active%20Development-22C55E" alt="Active Development"/>
</div>

<hr/>
## Why Memory

AI systems are powerful inside their current context window, but that context is temporary. Important decisions, user preferences, previous interactions, and learned knowledge disappear between sessions.

A larger prompt is not the same as memory.

Real memory must be:

- **Persistent** across sessions and model changes
- **Selective** about what deserves to be remembered
- **Grounded** in sources and provenance
- **Queryable** through semantic and structured retrieval
- **Inspectable** by the people operating the system
- **Governed** with clear access and retention controls

MemCode is building this layer as infrastructure rather than another temporary context workaround.




## Development

### Prerequisites

- Node.js
- npm

### Install dependencies

```bash
npm install
```

### Configure the environment

Copy the provided environment template:

```bash
cp .env.example .env.local
```

Update the values for your local or hosted environment. Do not commit production credentials or private keys.

### Start development

```bash
npm run dev
```

### Create a production build

```bash
npm run build
```

## Validation

Run the focused dashboard checks with:

```bash
npm run test:byok-usage
npm run test:runtime-settings
```

The production build also runs TypeScript validation before generating the Vite bundle.

## Deployment

The dashboard is configured for deployment through Cloudflare:

```bash
npm run build
npx wrangler deploy
```

Production environment variables should be configured through the deployment platform rather than committed to the repository.

The primary dashboard is available at [app.memcode.in](https://app.memcode.in).

## Project Status

MemCode is under active development. APIs, interfaces, and infrastructure may evolve as we improve retrieval quality, memory evaluation, integrations, and developer experience.

We are building toward a world where every AI system can remember selectively, retrieve reliably, and improve continuously.

