// Runs the learning service on your PC: .env.local (the local database) wins over .env, as for the platform.
//   pnpm learning:dev   (set HUB_API_URL to your local hub, e.g. http://localhost:8100/hub/api)
import "../../scripts/load-env";

void import("./server");
