import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { brand: { 50: '#eef6ff', 100: '#d9eaff', 500: '#2563eb', 600: '#1d4fd8', 700: '#1e40af', 900: '#16264f' } } } },
  plugins: []
};
export default config;
