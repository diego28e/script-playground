import { createPractice } from "@intellectif/lk-practice";

// The one lk-practice configuration for the platform (docs/practice.md). lk-practice hashes its configuration into
// every learner's state, so tasks and learners must use this same instance.
//
// acceptProofs adds "model-checked" to the defaults: a question's key is proven when a second model, from another
// provider, answers it blind and agrees. Code tasks are proven by running them ("executable").
export const practice = createPractice({ acceptProofs: ["executable", "reviewed", "model-checked"] });
