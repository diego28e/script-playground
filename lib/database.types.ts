export type Database = {
  public: {
    Tables: {
      challenge: {
        Row: {
          id: string;
          title: string;
          slug: string;
          description: string;
          starterCode: string;
          solutionCode: string | null;
          order: number;
          difficulty: "EASY" | "MEDIUM" | "HARD";
          createdAt: string;
          updatedAt: string;
        };
        Insert: {
          id?: string;
          title: string;
          slug: string;
          description: string;
          starterCode: string;
          solutionCode?: string | null;
          order: number;
          difficulty: "EASY" | "MEDIUM" | "HARD";
          createdAt?: string;
          updatedAt?: string;
        };
        Update: {
          id?: string;
          title?: string;
          slug?: string;
          description?: string;
          starterCode?: string;
          solutionCode?: string | null;
          order?: number;
          difficulty?: "EASY" | "MEDIUM" | "HARD";
          createdAt?: string;
          updatedAt?: string;
        };
      };
      submission: {
        Row: {
          id: string;
          userId: string;
          challengeId: string;
          code: string;
          status: "PENDING" | "PASSED" | "FAILED";
          output: string | null;
          error: string | null;
          createdAt: string;
        };
        Insert: {
          id?: string;
          userId: string;
          challengeId: string;
          code: string;
          status: "PENDING" | "PASSED" | "FAILED";
          output?: string | null;
          error?: string | null;
          createdAt?: string;
        };
        Update: {
          id?: string;
          userId?: string;
          challengeId?: string;
          code?: string;
          status?: "PENDING" | "PASSED" | "FAILED";
          output?: string | null;
          error?: string | null;
          createdAt?: string;
        };
      };
      label: {
        Row: {
          id: string;
          name: string;
          color: string;
        };
        Insert: {
          id?: string;
          name: string;
          color: string;
        };
        Update: {
          id?: string;
          name?: string;
          color?: string;
        };
      };
      _ChallengeToLabel: {
        Row: {
          A: string;
          B: string;
        };
        Insert: {
          A: string;
          B: string;
        };
        Update: {
          A?: string;
          B?: string;
        };
      };
    };
  };
};
