# File: security/backend_authentication.py

import os
from typing import Annotated, Optional
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import BaseModel, Field

import asyncio

# Load environment variables
SECRET_KEY = os.getenv("GPU_ACCESS_SECRET")
ALGORITHM = "HS256"
EXPECTED_AUDIENCE = os.getenv("SERVER_USERNAME")
EXPECTED_ISSUER = os.getenv("ALLOWED_NODE_USERNAME")
EXPECTED_SUBJECT = os.getenv("ALLOWED_NODE_USERNAME")

if not all([SECRET_KEY, EXPECTED_AUDIENCE, EXPECTED_ISSUER, EXPECTED_SUBJECT]):
    print(
        "One or more environment variables consisting of GPU_ACCESS_SECRET, SERVER_USERNAME, ALLOWED_NODE_USERNAME are not set."
    )
    raise ValueError("One or more environment variables are not set.")
    exit(1)


# Model for the token payload
class TokenPayLoad(BaseModel):
    sub: str = Field(..., description="Subject - Identifier of the client")
    iss: str = Field(..., description="Issuer - Who issued the token")
    aud: str = Field(..., description="Audience - Who the token is for")
    exp: int = Field(..., description="Expiration Time (Unix Timestamp)")
    iat: int = Field(..., description="Issued At Time (Unix Timestamp)")
    jti: str = Field(..., description="JWT ID - Unique token identifier")


# The tokenUrl is not actually used in this flow as Node.js generates the token,
# but it's required by OAuth2PasswordBearer. Provide a dummy URL.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="dummy_token_url_not_used")

# Load environment variables for development
ENV_TYPE = os.getenv("ENV_TYPE")
if not ENV_TYPE:
    print(
        "ENV_TYPE environment variable is not set. Defaulting to production for secrecy."
    )
    ENV_TYPE = "production"
print(f"ENV_TYPE: {ENV_TYPE}")
if ENV_TYPE == "development":
    # Dummy payload for development
    DUMMY_DEV_PAYLOAD = TokenPayLoad(sub="dev_user",iss="dev_issuer",aud="dev_audience",exp=9999999999,iat=0,jti="dummy_jti")

# Dependency for verification
async def verify_jwt_and_get_payload(
    token: Annotated[str, Depends(oauth2_scheme)],
) -> TokenPayLoad:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        # Decode the JWT token (automatically verifies signature using SECRET_KEY and ALGORITHM, expiration claim, audience and issuer
        payload_dict = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            audience=EXPECTED_AUDIENCE,
            issuer=EXPECTED_ISSUER,
        )

        # Use the TokenPayLoad model to validate and unpack the payload
        token_payload = TokenPayLoad(**payload_dict)

        # Explicitly verify that subject matches the expected subject in environment variable
        if token_payload.sub != EXPECTED_SUBJECT:
            print(
                f"Token subject {token_payload.sub} does not match expected subject {EXPECTED_SUBJECT}."
            )
            raise credentials_exception

    except JWTError as e:
        print(f"JWTError: {e}")
        raise credentials_exception
    except Exception as e:
        print(f"Unexpected error: {e}")
        raise credentials_exception
    return token_payload

# Dependency for development (conditional passthrough)
async def conditional_verify_jwt(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(HTTPBearer(), use_cache=False),
) -> Optional[TokenPayLoad]:
    """
    Conditionally verifies the JWT token based on the environment type.
    If in production, it verifies the token and returns the payload.
    If in development, it returns a dummy payload without verification.
    """
    if ENV_TYPE == "production":
        return await verify_jwt_and_get_payload(credentials.credentials)
    else:
        # In development, return a dummy payload
        return DUMMY_DEV_PAYLOAD