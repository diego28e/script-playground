// Runs the practice worker on your PC: .env.local (the local database) wins over .env, as for the platform.
//   pnpm practice-worker:dev
import "../../scripts/load-env";

void import("./worker");
