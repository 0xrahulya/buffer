# Buffer Video Uploader

A TypeScript project to upload videos to Buffer via their API.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the project root with your Buffer credentials:

```env
BUFFER_COOKIES=buffer_session=YOUR_SESSION_TOKEN;bufferapp_ci_session=YOUR_CI_SESSION
BUFFER_ORGANIZATION_ID=your_organization_id
BUFFER_CHANNEL_ID=your_channel_id
BUFFER_USER_ID=your_user_id
```

### How to get your credentials:

1. **Cookies**: 
   - Log in to Buffer (https://publish.buffer.com)
   - Open browser DevTools (F12)
   - Go to Application/Storage > Cookies
   - Copy the values for `buffer_session` and `bufferapp_ci_session`
   - Format: `buffer_session=YOUR_VALUE;bufferapp_ci_session=YOUR_VALUE`

2. **Organization ID and Channel ID**:
   - These can be found in the URL when viewing a channel: `https://publish.buffer.com/channels/{CHANNEL_ID}`
   - Organization ID can be found in network requests or the page source

3. **User ID**:
   - Can be extracted from cookies or found in network requests

## Usage

Upload a video to Buffer:

```bash
npm run upload
```

This will upload `1.mp4` from the project root to Buffer.

## How it works

The upload process follows these steps:

1. **Get S3 Pre-signed URL**: Requests a pre-signed URL from Buffer's GraphQL API
2. **Upload to S3**: Uploads the video file directly to AWS S3 using the pre-signed URL
3. **Register Upload**: Registers the uploaded media with Buffer to get video ID and metadata
4. **Create Post**: Creates a post in Buffer with the uploaded video

## Project Structure

```
.
├── src/
│   └── index.ts          # Main upload script
├── 1.mp4                 # Video file to upload
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
└── .env                  # Environment variables (not in git)
```

## Notes

- The video file `1.mp4` should be in the project root
- Make sure your cookies are valid and not expired
- The upload creates a post with "shareNow" mode, meaning it will be posted immediately

