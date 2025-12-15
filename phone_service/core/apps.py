APP_PACKAGES: dict[str, str] = {
    # Social / Community
    "小红书": "com.xingin.xhs",
    "推特": "com.twitter.android",
    "X": "com.twitter.android",
    "Twitter": "com.twitter.android",
    "Reddit": "com.reddit.frontpage",
    # Basic Android
    "System Home": "",
}


def list_supported_apps() -> list[str]:
    return sorted([k for k, v in APP_PACKAGES.items() if v])
