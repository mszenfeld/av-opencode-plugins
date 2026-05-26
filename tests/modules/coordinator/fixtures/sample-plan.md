---
source: feature/example-auth
branch: example-auth
base-url: http://localhost:3000
detected-tools: Bash(find:*), Bash(ls:*), Read, Write, Grep, Glob, Playwright, curl, psql
---

# QA Test Plan: Example Auth

## FE Test Scenarios

### FE-01: Login page loads

1. Navigate to `/login`
2. Assert page title contains "Login"
3. Assert a form with email and password fields exists
4. Take a screenshot named `login-page.png`

### FE-02: Invalid credentials show error

1. Navigate to `/login`
2. Fill email: `test@example.com`
3. Fill password: `wrong-password`
4. Click submit
5. Assert error message is visible
6. Take a screenshot named `login-error.png`

## BE Test Scenarios

### BE-01: POST /api/users returns 201

1. Send POST to `/api/users` with body `{"email":"new@example.com","password":"Test123!"}`
2. Assert HTTP status is 201
3. Assert response body contains an `id` field

### BE-02: GET /api/users/:id without auth returns 401

1. Send GET to `/api/users/123` with no Authorization header
2. Assert HTTP status is 401
3. Assert response body contains an error message
