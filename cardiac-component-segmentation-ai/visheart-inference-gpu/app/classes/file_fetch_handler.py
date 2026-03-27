import tempfile
import os
import tarfile
import aiohttp
import shutil
import argparse
from urllib.parse import urlparse
import asyncio
import sys


class FileFetchHandler:
    def __init__(self, presigned_url):
        """Initialize with a presigned URL"""
        self.presigned_url = presigned_url
        self.temp_dir = None
        self.file_path = None
        self.extracted_dir = None

    # Use async context manager methods
    async def __aenter__(self):
        """Asynchronous entry point for the context manager."""
        # Create temporary directory (synchronous, but fast)
        self.temp_dir = await asyncio.to_thread(tempfile.TemporaryDirectory)

        # Parse filename from URL (synchronous, fast)
        parsed_url = urlparse(self.presigned_url)
        filename = os.path.basename(parsed_url.path)

        # Create path for downloaded file (synchronous, fast)
        self.file_path = os.path.join(self.temp_dir.name, filename)

        # Create extraction directory (synchronous, fast)
        self.extracted_dir = os.path.join(self.temp_dir.name, "extracted")
        await asyncio.to_thread(os.makedirs, self.extracted_dir, exist_ok=True)

        # Download file using aiohttp (asynchronous)
        await self._download_file_async()

        # Extract if it's a tar file (offload synchronous blocking I/O)
        if filename.endswith((".tar", ".tar.gz", ".tgz")):
            await asyncio.to_thread(self._extract_tar_sync)

        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Asynchronous exit point for the context manager."""
        # Cleanup the temporary directory (offload synchronous blocking I/O)
        if self.temp_dir:
            await asyncio.to_thread(self.temp_dir.cleanup)

    async def _download_file_async(self):
        """Download file asynchronously using aiohttp."""
        print(f"Starting async download from: {self.presigned_url}")
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(self.presigned_url) as response:
                    if response.status == 200:
                        with open(self.file_path, "wb") as f:
                            while True:
                                chunk = await response.content.read(8192)  # Read in chunks
                                if not chunk:
                                    break
                                f.write(chunk)
                        print("Async download complete.")
                    elif response.status == 403:
                        print("Download failed: 403 Forbidden. URL may be expired/invalid.")
                        raise Exception(
                            "Presigned URL access denied (403). It may have expired or is invalid."
                        )
                    else:
                        error_text = await response.text()
                        print(f"Download failed: Status {response.status}, Error: {error_text[:200]}")  # Log snippet
                        raise Exception(
                            f"Failed to download file: {response.status}, Error: {error_text}"
                        )
        except aiohttp.ClientError as e:
            print(f"Network error during download: {e}")
            raise Exception(f"Network error during download: {e}") from e
        except Exception as e:
            print(f"Error during download process: {e}")
            raise Exception(f"Error during download process: {e}") from e

    def _extract_tar_sync(self):
        """Synchronous extraction (to be run in a thread)."""
        print("Starting tar extraction...")
        try:
            with tarfile.open(self.file_path) as tar:
                tar.extractall(path=self.extracted_dir)
            print("Tar extraction complete.")
        except tarfile.TarError as e:
            print(f"Error extracting tar file: {e}")
            raise Exception(f"Error extracting tar file: {e}") from e
        except Exception as e:
            print(f"Unexpected error during tar extraction: {e}")
            raise Exception(f"Unexpected error during tar extraction: {e}") from e

    # Synchronous methods that just return paths
    def get_file_path(self):
        """Return the path to the downloaded file"""
        return self.file_path

    def get_extracted_path(self):
        """Return the path to the extracted files"""
        return self.extracted_dir

    # Also provide a synchronous context manager version for backward compatibility
    def __enter__(self):
        # Create temporary directory
        self.temp_dir = tempfile.TemporaryDirectory()

        # Parse filename from URL
        parsed_url = urlparse(self.presigned_url)
        filename = os.path.basename(parsed_url.path)

        # Create path for downloaded file
        self.file_path = os.path.join(self.temp_dir.name, filename)

        # Create extraction directory
        self.extracted_dir = os.path.join(self.temp_dir.name, "extracted")
        os.makedirs(self.extracted_dir, exist_ok=True)

        # Download file using synchronous approach
        self._download_file_sync()

        # Extract if it's a tar file
        if filename.endswith((".tar", ".tar.gz", ".tgz")):
            self._extract_tar_sync()

        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Cleanup the temporary directory
        if self.temp_dir:
            self.temp_dir.cleanup()

    def _download_file_sync(self):
        """Synchronous download method for backward compatibility"""
        import requests  # Import here to keep it optional
        print(f"Starting synchronous download from: {self.presigned_url}")
        response = requests.get(self.presigned_url, stream=True)
        if response.status_code == 200:
            with open(self.file_path, "wb") as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            print("Synchronous download complete.")
        else:
            if response.status_code == 403:
                raise Exception(
                    "Presigned URL access denied with error 403. It may have expired or is invalid."
                )
            else:
                raise Exception(
                    f"Failed to download file: {response.status_code}, Error: {response.text}"
                )


async def list_files_recursively_async(path):
    """Recursively list all files in directory asynchronously"""
    result = []
    
    def walk_dir():
        walk_result = []
        for root, dirs, files in os.walk(path):
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, path)
                walk_result.append(rel_path)
        return walk_result
    
    return await asyncio.to_thread(walk_dir)


async def main_async():
    parser = argparse.ArgumentParser(
        description="Download and extract files from a presigned URL (async version)"
    )
    parser.add_argument("url", help="Presigned URL to download from")
    parser.add_argument("--sync", action="store_true", help="Use synchronous mode instead of async")
    args = parser.parse_args()

    print(f"Downloading from: {args.url}")

    try:
        if args.sync:
            # Use synchronous approach
            with FileFetchHandler(args.url) as handler:
                handle_results(handler, args.url)
        else:
            # Use asynchronous approach
            async with FileFetchHandler(args.url) as handler:
                await handle_results_async(handler, args.url)
                
    except Exception as e:
        print(f"\nError: {str(e)}")
        return 1

    print("\nCleanup complete. Files have been removed.")
    return 0


def handle_results(handler, url):
    """Handle results in synchronous mode"""
    print("\nDownload complete!")

    # Check if it's a tar file
    filename = os.path.basename(urlparse(url).path)
    if filename.endswith((".tar", ".tar.gz", ".tgz")):
        extracted_path = handler.get_extracted_path()
        print(f"\nExtracted files in: {extracted_path}")

        files = []
        for root, dirs, file_list in os.walk(extracted_path):
            for file in file_list:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, extracted_path)
                files.append(rel_path)
                
        print(f"\nFound {len(files)} files:")
        for file in files:
            print(f"  - {file}")
    else:
        file_path = handler.get_file_path()
        print(f"\nDownloaded file: {file_path}")

    print("\nPress Enter to clean up and exit...")
    input()  # Wait for user input before cleanup


async def handle_results_async(handler, url):
    """Handle results in asynchronous mode"""
    print("\nDownload complete!")

    # Check if it's a tar file
    filename = os.path.basename(urlparse(url).path)
    if filename.endswith((".tar", ".tar.gz", ".tgz")):
        extracted_path = handler.get_extracted_path()
        print(f"\nExtracted files in: {extracted_path}")

        files = await list_files_recursively_async(extracted_path)
        print(f"\nFound {len(files)} files:")
        for file in files:
            print(f"  - {file}")
    else:
        file_path = handler.get_file_path()
        print(f"\nDownloaded file: {file_path}")

    print("\nPress Enter to clean up and exit...")
    # This is blocking but it's user input so we can't make it async easily
    await asyncio.to_thread(input)  # Wait for user input before cleanup


def main():
    """Entry point that runs the async main function"""
    return asyncio.run(main_async())


# Example usage function
async def example_usage():
    # Example URL - replace with a valid one
    url = "YOUR_PRESIGNED_URL_HERE"
    try:
        async with FileFetchHandler(url) as handler:
            print("Inside async context manager")
            if handler.extracted_dir and os.path.exists(handler.extracted_dir):
                print(f"Extracted Path: {handler.get_extracted_path()}")
            elif handler.file_path and os.path.exists(handler.file_path):
                print(f"File Path: {handler.get_file_path()}")
    except Exception as e:
        print(f"Error in example usage: {e}")


if __name__ == "__main__":
    sys.exit(main())