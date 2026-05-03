# Room 113 Google Sign-In Setup

This site has a Google sign-in approval flow built in, but it needs a Firebase project before it can run.

1. Create a Firebase project.
2. In Firebase Authentication, enable Google as a sign-in provider.
3. In Firestore Database, create a database.
4. Copy the Firebase web app config into `index.html` where the `firebaseConfig` values say `PASTE_...`.
5. Publish the rules in `firestore.rules` to Firestore.
6. Sign in with `doublechecklearning@gmail.com` first. That account is the teacher account that can approve requests.

Students or other teachers can then sign in with Google. If they are not approved yet, the site creates an access request. The teacher account can approve requests from the tracker page.

Important: the current points tracker still stores point data in the browser on the teacher device. The next step for a fully shared secure version is moving students, houses, points, and history into Firestore under `trackerData`.
