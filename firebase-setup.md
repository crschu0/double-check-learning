# Room 113 Firebase Setup

This site uses Firebase for Google sign-in and shared classroom data.

1. Create a Firebase project.
2. In Firebase Authentication, enable Google as a sign-in provider.
3. In Firestore Database, create a database.
4. Copy the Firebase web app config into `index.html`.
5. Publish the rules in `firestore.rules` to Firestore.
6. Sign in with `cschuchard@maldenschool.org` first. That account creates the shared Firebase tracker documents and is the only admin account.

Approved teachers can sign in with Google and use the incentive tracker. They can add and remove points.

Mr. Schuchard can also manage students, houses, settings, access requests, Freckle data, and Scratch project data.

Firestore data layout:

- `trackerData/incentives`: shared incentive data for approved teachers.
- `privateProgress/progress`: Freckle and Scratch data. Firestore rules allow only `cschuchard@maldenschool.org` to read or write this document.

Important: changes to `firestore.rules` only protect Firebase after the rules are published in the Firebase console or deployed with the Firebase CLI.
