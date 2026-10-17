#import "../style.typ": *
#import "/code.typ": run

= Functions

#run("fib", ```python
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)

print([fib(n) for n in range(10)])
```, expect: "[0, 1, 1, 2, 3, 5, 8, 13, 21, 34]")
