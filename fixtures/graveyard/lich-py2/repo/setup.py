from distutils.core import setup

setup(
    name="lich",
    version="0.0.1",
    py_modules=["lich", "crypt"],
    install_requires=["mysql-python>=1.2"],
    python_requires="<3",
    classifiers=[
        "Programming Language :: Python :: 2",
        "Programming Language :: Python :: 2.7",
    ],
)
