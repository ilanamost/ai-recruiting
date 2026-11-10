# Prioritized Backlog

Current queue:



(empty)

## DONE

- [V] When trying to upload a CV in the real, not mock version, I get 500 Internal server error: [5ecd18f5-250b-4c22-9116-0c40f5fb07bb] unexpected error Error
    at UnknownErrorExceptionClosure (webpack:///src/shared/util.js:400:37)
    at Object.<anonymous> (webpack:///src/shared/util.js:393:30)
    at __w_pdfjs_require__ (webpack:///webpack/bootstrap%20c9be985464785b4e5413:19:1)
    at Object.<anonymous> (webpack:///src/pdf.js:24:23)
    at __w_pdfjs_require__ (webpack:///webpack/bootstrap%20c9be985464785b4e5413:19:1)
    at <anonymous> (webpack:///webpack/bootstrap%20c9be985464785b4e5413:62:1)
    at <anonymous> (webpack:///webpack/bootstrap%20c9be985464785b4e5413:62:1)
    at webpackUniversalModuleDefinition (webpack:///webpack/universalModuleDefinition:3:1)
    at Object.<anonymous> (webpack:///webpack/universalModuleDefinition:10:2)
    at Module._compile (node:internal/modules/cjs/loader:1871:14) {
  message: 'bad XRef entry',
  details: 'FormatError: bad XRef entry'
} | stack:full | plan:.plan/042-2026-11-10-cv-upload-xref-error.md

- [V] Add a loader component, The loader will be displayed until each api call finishes running. Add it instead of the already existing loader. | plan:.plan/035-2026-11-01-global-api-loader.md

- [V] Each Candidate type User should be able to edit only the Cvs that he has attached, not Cvs of other candidates. He should be able to delete the Cvs he attached as well and detuch them from a job | plan:.plan/009-2026-08-08-candidate-cv-ownership-scoping.md

- [V] There is a bug now: I am a candidate user, I uploaded a cv, I can view, detach and download it, but I can't view its' match result. As a Candidate I should be able to view the match result of a Cv that I have uploaded. That is the whole purpose of the application. However, I shouldn't be able to view the Cvs' and match results of other candidates. Admin can view and edit all. | plan:.plan/010-2026-08-09-candidate-own-match-visibility.md

- [V] Users of type 'Candidate' shouldn't be able to view attached CVs' of other Candidates in the Jobs route | plan:.plan/011-2026-08-09-candidate-job-cv-visibility.md

- [V] Preview of a .docx type file doesn't work well. The content is displayed as plain text. It should display the acctual file content, same as is displayed for pdf file. | plan:.plan/012-2026-08-09-docx-preview-rendering.md

- [V] The User should be able to search for jobs by name, location and date. He also should be able to filter for jobs he has applied to and those that he hasn't. The search and filter bar should appear below the "Jobs" title and fit the general application design. | plan:.plan/013-2026-08-10-job-search-filter.md

- [V] Improve UI and UX: add animations for Cvs that have over 80 score matches and Cvs with a low match score, when the match score appears. Add animation for the cards appearing in each route. "AI recruiting" shouldn't be with a cursor pointer since it is not clickable. Change scrollbar style globally in the application, make it thiner and with one of the theme colors light grey color. Suggest at least one more UI or UX improvement and implement it only if approved by me. | plan:.plan/014-2026-08-10-ui-ux-polish.md

- [V] For recruiters, hide the Cvs' route completly. Currently they can enter the route in readonly mode, there is no need for that, they can already view the uploaded cvs from the Jobs' route through Manage Cvs'. | plan:.plan/015-2026-08-10-hide-cvs-route-recruiter.md

- [V] Make the word document preview look similar to the pdf preview. Display the preview inside a container similar to the pdf viewer container in height and width. Add a box-shadow for styling consistent with the application UI. | plan:.plan/016-2026-08-10-docx-preview-container-styling.md

- [V] Create a home page for the application. The home page will have a short explanation of the applicatios' purpose: It will have 3 sections: the first explaining what the application does, below it a section of How it works and underneath it 'key features' list (with icons), The home page should be the start page of the application after logging in, regardless of the user Role. 'AI Recruiting' in the header should be a router link to the home page, with a cursor pointer on hover. Make sure the home page answers the following questions: 
What is this application?
Who is it for?
What problem does it solve?
How does it work?
What should I do next? | plan:.plan/017-2026-08-10-home-page.md

- [V] In the frontend Use pinia store with relevant files. Make all the api calls happen through the store files. add error handling with toaster messages for api error notifications. The UI components should call store files and these should handle the api calls. | plan:.plan/018-2026-08-10-pinia-stores.md

- [V] In mobile breakpoints, display a humburger icon for all the application links and hide the links from the nvabar itself. Also hide the words: AI recruiting and just show the icon | plan:.plan/019-2026-08-10-mobile-nav.md

- [V] Display a Job preview when clicking on a job description. Implement similarly to the CV preview. It should display a preview inisde an inner dialog with the whole Job details and the full description (currently only part of the data is displayed). | plan:.plan/020-2026-08-11-job-preview-dialog.md

- [V] For recruiters only: Cvs with the best match for the Job should be marked with a yellow star at the left, in the manage Cvs list. | plan:.plan/021-2026-08-11-best-match-star.md

- [V] In home page, I want the titles: "What it does", "How it works" and "Key features" to be collapsible accordions. Also, Add a favicon to the application | plan:.plan/022-2026-08-11-home-accordion-favicon.md

- [V] Toaster messages with api calls errors should not be thrown from the pinia store files directly, but from the UI components | plan:.plan/023-2026-08-11-toast-in-components.md

- [V] after changing an image in user settings, it is not updated automatically, only after refresh | plan:.plan/024-2026-08-11-profile-image-live-update.md

- [V] I want the accordions in home page to be open by default, not closed.

- [V] support different environments and not only localhost, which is developemnt. I want .env.staging and .env.production to be supported as well. Ideploy to gitub pages and leave instruction on how to fill the other .env files for the application to work there too and npt only on localhost. | plan:.plan/025-2026-08-16-multi-environment-support.md

- [V] There should be no hard coded values in the application - replace all toaster messages with constants that will be in a relevant utils file | plan:.plan/026-2026-08-17-toast-message-constants.md

- [V] Add a css preprocessor and use it for styling. Instead of regular css, use scss. | plan:.plan/027-2026-08-17-scss-preprocessor.md

- [V] Add pagination for each of the pages data, Cvs and jobs | plan:.plan/028-2026-09-06-pagination-cvs-jobs.md

- [V] Make the applocation more usefull for recruiters. Add filter for the following: Applicant experience: Junior, Mid, Senior, Decide the level of experience by the amount of years he/she is working on the industry. The filter should be available in the Cvs page. It should be displayed as a clickable tab that selects between the 3 options and displays only the relevant Cvs.I want the 5 most compatible users cvs to have stars, currently there is only one. Also, add a filter for skills, that will filter applicants by certain skills recruiters are looking for. The skills and experience data will come from the applicants Cvs'. | plan:.plan/029-2026-09-07-cv-recruiter-filter.md

- [V] Remove the abillity to upload and view a CV in a word format, I want the cvs in the application to be only in pdf format for consistency. Remove all logic and tests contencted to the word format and if there were relvant libraries installed, remove them. | plan:.plan/030-2026-09-08-remove-docx-cv-support.md

- [V] I signed up as a candidate, and noticed that in the Cvs route I can view the cvs of the other users. I should be able to see only my own Cvs'. | plan:.plan/032-2026-09-10-candidate-cv-list-ownership-scoping.md

- [V] When I ran the app on a real iphone13 device I got the following issues: 1. I cannot see the app content: I get 'Not authenticated' errors on all routes. 2. The app content is too close to the edges of the device, and part of the navbar is cut as a result. It should be adjusted to mobile devices sizes, there should be padding in the app pages and the navabar. | stack:full | plan:.plan/036-2026-11-07-mobile-iphone-auth-and-layout.md

- [V] on an iphone 13 device - some of the texts appear cut, spread out to several rows instead of remaining on a single row - The attached cvs number and text in the Jobs route (like 3 cvs) for example, check if it happens in other places as well and fix. 

- [V] Support a LLM_MODE=mock .env variable, so that analysis and scoring will work without an LLM model as well. | stack:full | plan:.plan/038-2026-11-08-llm-mode-mock.md

- [V] When the application loads, on the login and Signup pages, a password appeares in the password field.
Password field should be empty untill the user has entered credentials. It shouldn't be filled after refresh and logout either. | plan:.plan/039-2026-11-08-login-password-field-empty.md

- [V] When the user is logged out, he shouldn't be able to see buttons that are inactive. He shouldn't be able to see the different application routes in the navbar, except 'AI Recruiting' - that should be visible, but not clickable. He shouldn't be able to see the gear icon with the 'user settings' and 'logout' options. The placeholder and the light/dark switch can remain. The gear icon can either be removed or remain but be unclickable. | plan:.plan/040-2026-11-08-logged-out-navbar.md

- [V] Job matches issue: when I click on a resume in manage cvs, there are 2 match calls, one looks for an existing match, and the other calculates a new one. The behaviour is correct, however if there is no existing match, an error is returned and thrown in a console. I don't think it is even an error, a match wasn't created yet and it is a logical behaviour of the application. Make it a seperate state, not an error, and do not display an error message in the console. | stack:full | plan:.plan/041-2026-11-08-no-existing-match-state.md