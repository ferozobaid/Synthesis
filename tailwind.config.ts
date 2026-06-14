import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Synthesis palette — calm, professional, interview-prep tone.
        ink: "#0f172a",
        paper: "#f8fafc",
        accent: "#4f46e5",
      },
    },
  },
  plugins: [],
};

export default config;
