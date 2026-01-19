# Shared Shopping List PWA (NoCoDB)

A lightweight, offline-ready Progressive Web App (PWA) for managing a shared shopping list. It syncs data in real-time (polling) using a [NoCoDB](https://nocodb.com/) database.

## Features

*   **Multi-User Sync:** Updates from other users appear automatically (polled every 5s).
*   **Tags & Filtering:** Add tags to items (e.g., "Milk #aldi") to automatically generate filter chips.
*   **Sorting:** Items are sorted alphabetically, completed items are greyed out and have a strike-through effect.
*   **Private Config:** API credentials are stored in your browser's LocalStorage, not in the code.
*   **PWA Ready:** Installable on Android/iOS via "Add to Home Screen".

## Usage

### Adding Items
Type the item name. You can add one or more tags using `#`.
*   Example: `Apples #market`
*   Example: `Scews #hardware-store #renovation`

### Filtering
Tap the chips at the top of the list (e.g., `market`) to show only items with that tag. Tap `All` to reset.

### Editing
Click on the text of any item to rename it or change tags.

---

## Setup Guide

### 1. Database Setup (NoCoDB)
1.  Create a new Project in NoCoDB.
2.  Create a new Table (e.g., named `ShoppingList`).
3.  Ensure the table has the following columns:
    *   `Title` (Type: `SingleLineText`) - **Required**
    *   `IsDone` (Type: `Checkbox`) - **Required**
    *   (Delete other default columns if you want, or leave them)
4.  Generate an API Token:
    *   Go to `Settings` > `API Tokens` > `Create New Token`.
    *   Copy the token.

### 2. Deployment (GitHub Pages)
1.  Fork this repository or upload the files to a new GitHub repository.
2.  Go to `Settings` > `Pages`.
3.  Select `main` branch as the source and save.
4.  Wait for the deployment to finish. Open the provided URL.

### 3. App Configuration
1.  Open the deployed web app.
2.  You will be prompted to enter your **Connection Settings**.
3.  **Table API URL:** Open your NoCoDB table, click the "Code snippet" (</>) icon or check the REST API docs. Copy the "List rows" endpoint.
    *   **V2 Example:** `https://app.nocodb.com/api/v1/db/data/v1/p_xxxxxxx/ShoppingList`
    *   **V3 Example:** `https://app.nocodb.com/api/v3/data/abc12345/xyz6789/records`
4.  **API Token:** Paste the token you generated in Step 1.
5.  Click **Save & Connect**.

## Local Development
To run locally, you need a simple HTTP server because of CORS and ES Modules.
```bash
npx serve .
```
Then open `http://localhost:3000`.
