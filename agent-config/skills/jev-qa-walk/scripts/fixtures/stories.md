# Fixture stories

<!-- Test fixture for jev-qa-walk. Not this repository's USER_STORIES.md. -->

## US-901 Reach the Habitat desk

Statement: When I work a project, I want its desk, so I can see its work.

Criteria:
1. WHEN I select Habitat from the dashboard, THE SYSTEM SHALL show the Habitat desk.
   <!-- walk: path=/habitat.html; text=Habitat desk -->

## US-902 Show the 7-day badges

Statement: When I open a project desk, I want its 7-day badges, so I can see what needs review.

Criteria:
1. WHEN the desk loads, THE SYSTEM SHALL show the 7-day review badges.
   <!-- walk: path=/desk-badges.html; text=7d badges -->

## US-903 Read the dark rail

Statement: When I use the app at night, I want a readable dark rail, so I can find projects.

Criteria:
1. WHEN the theme is dark, THE SYSTEM SHALL render rail labels at readable contrast.
   <!-- walk: path=/visual.html; text=readable contrast -->

## US-904 Open the desk from a copy-lie page

Statement: When helper copy claims the desk is ready, I want the desk itself, so I am not misled.

Criteria:
1. WHEN I select Habitat, THE SYSTEM SHALL show the Habitat desk.
   <!-- walk: path=/habitat.html; text=Habitat desk -->

## US-905 Chain from the dashboard to pull requests

Statement: When I work Habitat, I want its desk and then its pull requests, so I can see open work.

Criteria:
1. WHEN I select Habitat, THE SYSTEM SHALL show the Habitat desk.
   <!-- walk: path=/habitat.html; text=Habitat desk -->
2. WHEN I open pull requests from the desk, THE SYSTEM SHALL show the pull request list.
   <!-- walk: path=/prs.html; text=Pull requests -->

## US-906 Already on the desk

Statement: When the walk starts on the desk, I want the criterion settled from code alone.

Criteria:
1. WHEN the walk starts on the desk, THE SYSTEM SHALL confirm the desk from code alone.
   <!-- walk: path=/habitat.html; text=Habitat desk -->
