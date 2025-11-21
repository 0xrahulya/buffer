import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as mime from 'mime-types';
import * as dotenv from 'dotenv';

dotenv.config();

interface S3PreSignedURLResponse {
    data: {
        s3PreSignedURL: {
            url: string;
            key: string;
            bucket: string;
        };
    };
}

interface UploadMediaDetails {
    location: string;
    file_size: number;
    file_extension: string;
    duration: number;
    duration_millis: number;
    width: number;
    height: number;
    format?: string;
    video_format?: string;
    frame_rate?: number;
    video_bitrate?: number;
    audio_codec?: string;
    audio_bitrate?: number;
    rotation?: number;
    required_transcoding?: boolean;
}

interface UploadMediaResult {
    success: boolean;
    upload_id: string;
    details: UploadMediaDetails;
    location: string;
    type: string;
    title: string;
    transcodeVideo: boolean;
}

interface UploadMediaResponse {
    result: UploadMediaResult;
}

interface CaptionsFile {
    captions: string[];
}

class BufferUploader {
    private cookies: string;
    private organizationId: string;
    private channelId: string;
    private userId: string;
    private graphQLEndpoint = 'https://graph.buffer.com/?_o=s3PreSignedURL';
    private composerApiEndpoint = 'https://publish.buffer.com/rpc/composerApiProxy';

    constructor() {
        this.cookies = process.env.BUFFER_COOKIES || '';
        this.organizationId = process.env.BUFFER_ORGANIZATION_ID || '';
        this.channelId = process.env.BUFFER_CHANNEL_ID || '';
        this.userId = process.env.BUFFER_USER_ID || '';

        if (!this.cookies || !this.organizationId || !this.channelId) {
            throw new Error('Missing required environment variables. Please check your .env file.');
        }
    }

    /**
     * Get S3 pre-signed URL for uploading the video
     */
    private async getS3PreSignedURL(fileName: string, mimeType: string): Promise<{ url: string; key: string }> {
        const query = `
      query s3PreSignedURL($input: S3PreSignedURLInput!) {
        s3PreSignedURL(input: $input) {
          url
          key
          bucket
        }
      }
    `;

        const variables = {
            input: {
                organizationId: this.organizationId,
                fileName: fileName,
                mimeType: mimeType,
                uploadType: 'postAsset'
            }
        };

        try {
            const response = await axios.post<S3PreSignedURLResponse>(
                this.graphQLEndpoint,
                {
                    operationName: 's3PreSignedURL',
                    variables,
                    query
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': this.cookies,
                        'x-buffer-client-id': 'webapp-publishing',
                        'Origin': 'https://publish.buffer.com',
                        'Referer': 'https://publish.buffer.com/',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
                    }
                }
            );

            if (response.data?.data?.s3PreSignedURL?.url && response.data?.data?.s3PreSignedURL?.key) {
                return {
                    url: response.data.data.s3PreSignedURL.url,
                    key: response.data.data.s3PreSignedURL.key
                };
            }

            throw new Error('Failed to get S3 pre-signed URL');
        } catch (error: any) {
            if (error.response) {
                console.error('GraphQL Error Response:', error.response.data);
                throw new Error(`Failed to get S3 pre-signed URL: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    /**
     * Upload video file to S3 using pre-signed URL
     */
    private async uploadToS3(preSignedURL: string, filePath: string, mimeType: string): Promise<void> {
        const fileBuffer = fs.readFileSync(filePath);
        const fileSize = fileBuffer.length;

        try {
            await axios.put(preSignedURL, fileBuffer, {
                headers: {
                    'Content-Type': mimeType,
                    'Content-Length': fileSize.toString(),
                    'Origin': 'https://publish.buffer.com',
                    'Referer': 'https://publish.buffer.com/',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            console.log('✓ Video uploaded to S3 successfully');
        } catch (error: any) {
            if (error.response) {
                console.error('S3 Upload Error Response:', error.response.status, error.response.statusText);
                throw new Error(`Failed to upload to S3: ${error.response.statusText}`);
            }
            throw error;
        }
    }

    /**
     * Register the uploaded media with Buffer and get video details
     */
    private async registerUpload(s3Key: string): Promise<UploadMediaResponse> {
        const requestBody = {
            args: JSON.stringify({
                url: '/i/uploads/upload_media.json',
                args: {
                    key: s3Key,
                    serviceForceTranscodeVideo: false
                },
                HTTPMethod: 'POST'
            })
        };

        try {
            const response = await axios.post<{ result: UploadMediaResponse } | UploadMediaResponse>(
                this.composerApiEndpoint,
                requestBody,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': this.cookies,
                        'Origin': 'https://publish.buffer.com',
                        'Referer': `https://publish.buffer.com/channels/${this.channelId}`,
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
                    }
                }
            );

            // Log the response to debug the structure
            console.log('Register upload response:', JSON.stringify(response.data, null, 2));

            // Check if response has result property (wrapped response)
            if (response.data && 'result' in response.data && response.data.result) {
                return response.data as UploadMediaResponse;
            }

            throw new Error('Failed to register upload: Unexpected response structure');
        } catch (error: any) {
            if (error.response) {
                console.error('Register Upload Error Response:', error.response.status, error.response.data);
                throw new Error(`Failed to register upload: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    /**
     * Create a post in Buffer with the uploaded video
     */
    private async createPost(uploadResponse: UploadMediaResponse, text: string = ''): Promise<void> {
        if (!uploadResponse.result || !uploadResponse.result.details) {
            throw new Error('Video details not found in upload response');
        }

        const result = uploadResponse.result;
        const details = result.details;

        const postData = {
            share_mode: 'shareNow',
            now: true,
            top: false,
            is_draft: false,
            shorten: true,
            text: text,
            scheduling_type: 'direct',
            fb_text: '',
            entities: null,
            annotations: [],
            profile_ids: [this.channelId],
            attachment: false,
            via: null,
            duplicated_from: null,
            created_source: 'channel',
            channel_data: {
                instagram: {
                    share_to_feed: true
                }
            },
            tags: [],
            update_type: 'reels',
            media: {
                progress: 100,
                uploaded: true,
                uploading_type: 'video',
                video: {
                    title: result.title,
                    id: result.upload_id,
                    details: {
                        location: details.location,
                        transcoded_location: details.location,
                        file_size: details.file_size,
                        duration: details.duration,
                        duration_millis: details.duration_millis,
                        width: details.width,
                        height: details.height
                    },
                    thumb_offset: 0,
                    thumbnails: []
                },
                thumbnail: ''
            },
            ai_assisted: false,
            channelGroupIds: []
        };

        const requestBody = {
            args: JSON.stringify({
                url: '/1/updates/create.json',
                args: postData,
                HTTPMethod: 'POST'
            })
        };

        try {
            const response = await axios.post(
                this.composerApiEndpoint,
                requestBody,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': this.cookies,
                        'Origin': 'https://publish.buffer.com',
                        'Referer': `https://publish.buffer.com/channels/${this.channelId}`,
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
                    }
                }
            );

            console.log('✓ Post created successfully');
            console.log('Response:', JSON.stringify(response.data, null, 2));
        } catch (error: any) {
            if (error.response) {
                console.error('Create Post Error Response:', error.response.status, error.response.data);
                throw new Error(`Failed to create post: ${JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    /**
     * Main upload method
     */
    async uploadVideo(filePath: string, text: string = ''): Promise<void> {
        console.log(`Starting upload of ${filePath}...`);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const fileName = path.basename(filePath);
        const mimeType = mime.lookup(filePath) || 'video/mp4';
        const fileStats = fs.statSync(filePath);

        console.log(`File: ${fileName}`);
        console.log(`Size: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`MIME Type: ${mimeType}`);

        // Step 1: Get S3 pre-signed URL
        console.log('\n1. Getting S3 pre-signed URL...');
        const { url: preSignedURL, key: s3Key } = await this.getS3PreSignedURL(fileName, mimeType);
        console.log('✓ Got S3 pre-signed URL');

        // Step 2: Upload to S3
        console.log('\n2. Uploading video to S3...');
        await this.uploadToS3(preSignedURL, filePath, mimeType);

        // Step 3: Register upload with Buffer to get video ID and details
        console.log('\n3. Registering upload with Buffer...');
        const uploadResponse = await this.registerUpload(s3Key);
        console.log('✓ Upload registered, video ID:', uploadResponse.result?.upload_id);

        // Step 4: Create post
        console.log('\n4. Creating post in Buffer...');
        await this.createPost(uploadResponse, text);

        console.log('\n✓ Upload complete!');
    }
}

/**
 * Get a random caption from captions.json
 */
function getRandomCaption(): string {
    const captionsPath = path.join(process.cwd(), 'captions.json');
    const defaultCaption = 'Check out this video!';

    try {
        if (!fs.existsSync(captionsPath)) {
            console.log('captions.json not found, using default caption');
            return defaultCaption;
        }

        const captionsData = fs.readFileSync(captionsPath, 'utf-8');
        const captionsFile: CaptionsFile = JSON.parse(captionsData);

        if (!captionsFile.captions || !Array.isArray(captionsFile.captions) || captionsFile.captions.length === 0) {
            console.log('No captions found in captions.json, using default caption');
            return defaultCaption;
        }

        const randomIndex = Math.floor(Math.random() * captionsFile.captions.length);
        return captionsFile.captions[randomIndex];
    } catch (error: any) {
        console.log(`Error reading captions.json: ${error.message}, using default caption`);
        return defaultCaption;
    }
}

/**
 * Find the first .mp4 video file in the uploads folder
 */
function findVideoFile(): string | null {
    const uploadsDir = path.join(process.cwd(), 'uploads');

    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
        console.log('Created uploads directory');
        return null;
    }

    // Read directory and find .mp4 files
    const files = fs.readdirSync(uploadsDir);
    const mp4Files = files.filter(file => file.toLowerCase().endsWith('.mp4'));

    if (mp4Files.length === 0) {
        return null;
    }

    // Return the first .mp4 file found
    return path.join(uploadsDir, mp4Files[0]);
}

/**
 * Move video file to done folder
 */
function moveVideoToDone(videoPath: string): void {
    const doneDir = path.join(process.cwd(), 'done');

    // Create done directory if it doesn't exist
    if (!fs.existsSync(doneDir)) {
        fs.mkdirSync(doneDir, { recursive: true });
    }

    const fileName = path.basename(videoPath);
    const destinationPath = path.join(doneDir, fileName);

    fs.renameSync(videoPath, destinationPath);
    console.log(`✓ Video moved to done folder: ${destinationPath}`);
}

// Main execution
async function main() {
    try {
        // Find a video file in uploads folder
        const videoPath = findVideoFile();

        if (!videoPath) {
            // Exit silently if no videos found
            process.exit(0);
        }

        // Get random caption
        const caption = getRandomCaption();
        console.log(`Selected caption: ${caption}`);

        // Upload video
        const uploader = new BufferUploader();
        await uploader.uploadVideo(videoPath, caption);

        // Move video to done folder after successful upload
        moveVideoToDone(videoPath);

        console.log('\n✓ Process complete!');
    } catch (error: any) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main();

