/**
 * App configuration.
 * GOOGLE_CLIENT_ID must be a "Web Application" OAuth client (not Desktop App).
 * Create one at: console.cloud.google.com/apis/credentials
 * → + Create credentials → OAuth client ID → Web application
 * → Add Authorized JavaScript origins:
 *     http://localhost:3000
 *     https://your-app.vercel.app
 */

const CONFIG = {
  // Replace with your Web Application OAuth Client ID:
  GOOGLE_CLIENT_ID: '129874361472-srholbfj5nmqnv51rm9regb8jpokvgis.apps.googleusercontent.com',

  // Google Drive OAuth scope
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive',

  // Google Drive REST API base
  DRIVE_API: 'https://www.googleapis.com/drive/v3',

  // Flora technique (from run_pdp.js)
  FLORA_TECHNIQUE: 'pdp-product-shot-generator',
  FLORA_WORKSPACE: 'ws_qd7amwxs2qks9ywzt57zrpabr586rhj6',
  FLORA_PROJECT:   'prj_ns7fwf3m2mkyhfqeqse8xkyras87stry',

  // Flora prompts (matching run_pdp.js config.json)
  FRONTAL_PROMPT: 'Straight-on full-body frontal editorial catalog pose facing the camera, centered symmetrical stance, both shoulders visible, feet visible, no side profile, no three-quarter angle, no turned body. Preserve the model identity and facial features from the model reference only — use a slim, non-pregnant, standard editorial model figure. Apply the exact garment look and footwear from the clothing and product references, matching silhouette, artwork placement, colors, fabric texture, shoe shape, proportions, and styling as closely as possible. Use the clean light ivory high-flash studio background reference: seamless ivory wall and floor, crisp flash shadow, no furniture, no pedestal, no marble, no props. Do not invent garments, change product colors, replace shoes, add logos, alter the model identity, or use a side pose.',

  // Vercel API proxy URL (no trailing slash)
  API_BASE: '/api',

  // Subfolder names to look for in the client folder
  MODELS_FOLDER:      'Models',
  BACKGROUNDS_FOLDER: 'Backgrounds',

  // Regex to detect "Look N" subfolders (case-insensitive)
  LOOK_FOLDER_RE: /^look\s*\d+$/i,

  // Input slot order for the Flora technique
  INPUT_ORDER: ['sku-top', 'sku-bottom', 'footwear', 'accessories', 'model-face', 'background'],

  // Cost per run (for display)
  COST_PER_RUN: 0.90,
};
